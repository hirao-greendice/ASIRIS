"use strict";

const TILE_CATALOG = Object.freeze({
  floor: 0,
  floorDetail: 1,
  wall: 2,
  player: 171,
  sword: 424,
  slime: 264,
  boss: 274,
  doorClosed: 444,
  doorOpen: 447,
  apple: 915,
  key: 571,
  crown: 141,
  goal: 1007,
  marker: 522,
});

(() => {
  const GRID_SIZE = 12;
  const TILE_SIZE = 16;
  const CANVAS_SIZE = GRID_SIZE * TILE_SIZE;
  const ATLAS_COLUMNS = 49;
  const ATLAS_ROWS = 22;
  const ATLAS_FRAME_COUNT = ATLAS_COLUMNS * ATLAS_ROWS;
  const ATLAS_STRIDE = 17;
  const STORAGE_KEY = "asiris-stage-editor-v1";
  const MOVE_COOLDOWN = 85;
  const HOLD_DELAY = 260;
  const HOLD_INTERVAL = 135;

  const DIRECTIONS = Object.freeze({
    up: Object.freeze({ x: 0, y: -1, label: "上" }),
    right: Object.freeze({ x: 1, y: 0, label: "右" }),
    down: Object.freeze({ x: 0, y: 1, label: "下" }),
    left: Object.freeze({ x: -1, y: 0, label: "左" }),
  });

  const OBJECT_DEFINITIONS = Object.freeze({
    player: Object.freeze({ label: "主人公", frame: TILE_CATALOG.player }),
    sword: Object.freeze({ label: "ソード君", frame: TILE_CATALOG.sword }),
    slime: Object.freeze({ label: "スライム", frame: TILE_CATALOG.slime }),
    boss: Object.freeze({ label: "ボス", frame: TILE_CATALOG.boss }),
    doorClosed: Object.freeze({ label: "閉じた扉", frame: TILE_CATALOG.doorClosed, blocks: true }),
    doorOpen: Object.freeze({ label: "開いた扉", frame: TILE_CATALOG.doorOpen }),
    apple: Object.freeze({ label: "リンゴ", frame: TILE_CATALOG.apple }),
    key: Object.freeze({ label: "鍵", frame: TILE_CATALOG.key }),
    crown: Object.freeze({ label: "王冠", frame: TILE_CATALOG.crown }),
    goal: Object.freeze({ label: "ゴール", frame: TILE_CATALOG.goal }),
    marker: Object.freeze({ label: "マーカー", frame: TILE_CATALOG.marker }),
  });

  const EDITOR_TOOLS = Object.freeze([
    Object.freeze({ key: "eraser", kind: "eraser", label: "消しゴム" }),
    Object.freeze({ key: "floor", kind: "tile", tile: 0, frame: TILE_CATALOG.floor, label: "床" }),
    Object.freeze({ key: "floorDetail", kind: "tile", tile: 1, frame: TILE_CATALOG.floorDetail, label: "模様床" }),
    Object.freeze({ key: "wall", kind: "tile", tile: 2, frame: TILE_CATALOG.wall, label: "壁" }),
    ...Object.entries(OBJECT_DEFINITIONS).map(([key, definition]) => Object.freeze({
      key,
      kind: "object",
      type: key,
      frame: definition.frame,
      label: definition.label,
    })),
  ]);

  const canvas = document.querySelector("#game-canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const gameApp = document.querySelector("#game-app");
  const atlasView = document.querySelector("#atlas-view");
  const stageLabelElement = document.querySelector("#stage-label");
  const modeBadge = document.querySelector("#mode-badge");
  const assetStatus = document.querySelector("#asset-status");
  const logElement = document.querySelector("#game-log-text");
  const editorPanel = document.querySelector("#editor-panel");
  const editorPalette = document.querySelector("#editor-palette");
  const debugPanel = document.querySelector("#debug-panel");
  const jsonField = document.querySelector("#stage-json");
  const tileSheet = new Image();

  let storageStatus = "未保存";
  const initialStages = normalizeStages(globalThis.STAGES);
  let workingStages = loadStoredStages() ?? deepClone(initialStages);
  let currentStageIndex = findStartingStageIndex(workingStages);
  let storageTimer = null;
  let tileSheetReady = false;
  let atlasBuilt = false;

  const state = {
    mode: "play",
    player: { x: 1, y: 1, facing: "down" },
    sword: { x: 2, y: 1 },
    runtimeObjects: [],
    selectedTool: "floor",
    showGrid: false,
    showCollision: false,
    warpMode: false,
    editorCursor: null,
    painting: false,
    lastPaintedCell: "",
    lastMoveAt: 0,
    heldDirections: new Map(),
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeStages(definitions) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      throw new Error("stages.jsにステージ定義がありません。");
    }
    const ids = new Set();
    return definitions.map((definition, index) => normalizeStage(definition, index, ids));
  }

  function normalizeStage(definition, index, ids = new Set()) {
    if (!definition || typeof definition !== "object") throw new Error(`ステージ${index + 1}の形式が不正です。`);
    const id = String(definition.id ?? `stage${String(index + 1).padStart(2, "0")}`);
    if (ids.has(id)) throw new Error(`ステージID ${id} が重複しています。`);
    ids.add(id);
    if (definition.width !== GRID_SIZE || definition.height !== GRID_SIZE) {
      throw new Error(`${id}はwidth/heightを12にしてください。`);
    }
    if (!Array.isArray(definition.tiles) || definition.tiles.length !== GRID_SIZE) {
      throw new Error(`${id}のtilesは12行必要です。`);
    }

    const tiles = definition.tiles.map((row, y) => {
      if (!Array.isArray(row) || row.length !== GRID_SIZE) throw new Error(`${id}のtiles[${y}]は12列必要です。`);
      return row.map((tile) => {
        const value = Number(tile);
        if (![0, 1, 2].includes(value)) throw new Error(`${id}に未対応のタイル値があります。`);
        return value;
      });
    });

    const objects = (Array.isArray(definition.objects) ? definition.objects : []).map((object, objectIndex) => {
      if (!OBJECT_DEFINITIONS[object.type]) throw new Error(`${id}のobjects[${objectIndex}]に未対応のtypeがあります。`);
      const x = Number(object.x);
      const y = Number(object.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !isInside(x, y)) {
        throw new Error(`${id}のobjects[${objectIndex}]がステージ外です。`);
      }
      return {
        type: object.type,
        x,
        y,
        properties: object.properties && typeof object.properties === "object" ? deepClone(object.properties) : {},
      };
    });

    const players = objects.filter((object) => object.type === "player");
    if (players.length > 1) throw new Error(`${id}に主人公を複数配置できません。`);

    return {
      id,
      name: String(definition.name ?? id),
      width: GRID_SIZE,
      height: GRID_SIZE,
      tiles,
      objects,
    };
  }

  function isInside(x, y) {
    return x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE;
  }

  function loadStoredStages() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (!value) return null;
      const parsed = JSON.parse(value);
      const definitions = Array.isArray(parsed) ? parsed : parsed.stages;
      const stages = normalizeStages(definitions);
      storageStatus = "保存データ読込済み";
      return stages;
    } catch {
      storageStatus = "保存データ読込失敗";
      return null;
    }
  }

  function scheduleStorageSave() {
    storageStatus = "保存待ち";
    updateDebugPanel();
    if (storageTimer !== null) window.clearTimeout(storageTimer);
    storageTimer = window.setTimeout(saveStagesNow, 120);
  }

  function saveStagesNow() {
    if (storageTimer !== null) window.clearTimeout(storageTimer);
    storageTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, stages: workingStages }));
      storageStatus = `保存済み ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    } catch {
      storageStatus = "保存不可";
    }
    updateDebugPanel();
  }

  function findStartingStageIndex(stages) {
    const requestedId = new URLSearchParams(location.search).get("stage");
    const requestedIndex = stages.findIndex((stage) => stage.id === requestedId);
    return requestedIndex >= 0 ? requestedIndex : 0;
  }

  function currentStage() {
    return workingStages[currentStageIndex];
  }

  function findFirstWalkable(stage) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (stage.tiles[y][x] !== 2) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  function createRuntimeFromStage() {
    const stage = currentStage();
    const playerObject = stage.objects.find((object) => object.type === "player") ?? findFirstWalkable(stage);
    const swordObject = stage.objects.find((object) => object.type === "sword") ?? {
      x: Math.min(playerObject.x + 1, GRID_SIZE - 1),
      y: playerObject.y,
    };
    state.player = { x: playerObject.x, y: playerObject.y, facing: "down" };
    state.sword = { x: swordObject.x, y: swordObject.y };
    state.runtimeObjects = deepClone(stage.objects.filter((object) => !["player", "sword"].includes(object.type)));
    state.lastMoveAt = Number.NEGATIVE_INFINITY;
    state.editorCursor = null;
  }

  function updateStageUrl() {
    try {
      const url = new URL(location.href);
      url.searchParams.delete("atlas");
      url.searchParams.set("stage", currentStage().id);
      history.replaceState(null, "", url);
    } catch {
      // file: URLでもゲームは継続できます。
    }
  }

  function loadStage(index, message) {
    currentStageIndex = (index + workingStages.length) % workingStages.length;
    stopAllDirections();
    createRuntimeFromStage();
    updateStageUrl();
    setLog(message ?? `${currentStage().name}を読み込みました`);
    render();
  }

  function resetStage() {
    createRuntimeFromStage();
    setLog("ステージをリセットしました");
    render();
  }

  function changeStage(offset) {
    if (workingStages.length === 1) {
      resetStage();
      setLog("登録されているステージは1つです");
      return;
    }
    loadStage(currentStageIndex + offset);
  }

  function setLog(message) {
    logElement.textContent = message;
  }

  function frameSource(frameNumber) {
    const column = frameNumber % ATLAS_COLUMNS;
    const row = Math.floor(frameNumber / ATLAS_COLUMNS);
    return { sourceX: column * ATLAS_STRIDE, sourceY: row * ATLAS_STRIDE };
  }

  function drawFallbackFrame(targetContext, frameNumber, destinationX, destinationY) {
    const colors = ["#171321", "#8b7ca7", "#756b63", "#dfd9cf", "#526da6", "#b84259", "#e4dc39"];
    targetContext.fillStyle = colors[frameNumber % colors.length];
    targetContext.fillRect(destinationX, destinationY, TILE_SIZE, TILE_SIZE);
    targetContext.fillStyle = "#08070d";
    targetContext.fillRect(destinationX + 4, destinationY + 4, 8, 8);
  }

  function drawFrameTo(targetContext, frameNumber, destinationX, destinationY, options = {}) {
    const { flipX = false, alpha = 1, selected = false } = options;
    const { sourceX, sourceY } = frameSource(frameNumber);
    targetContext.save();
    targetContext.globalAlpha = alpha;
    targetContext.imageSmoothingEnabled = false;

    if (flipX) {
      targetContext.translate(destinationX + TILE_SIZE, destinationY);
      targetContext.scale(-1, 1);
      if (tileSheetReady) {
        targetContext.drawImage(tileSheet, sourceX, sourceY, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
      } else {
        drawFallbackFrame(targetContext, frameNumber, 0, 0);
      }
    } else if (tileSheetReady) {
      targetContext.drawImage(
        tileSheet,
        sourceX,
        sourceY,
        TILE_SIZE,
        TILE_SIZE,
        destinationX,
        destinationY,
        TILE_SIZE,
        TILE_SIZE,
      );
    } else {
      drawFallbackFrame(targetContext, frameNumber, destinationX, destinationY);
    }
    targetContext.restore();

    if (selected) {
      targetContext.save();
      targetContext.strokeStyle = "#e4dc39";
      targetContext.lineWidth = 1;
      targetContext.strokeRect(destinationX + 0.5, destinationY + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      targetContext.restore();
    }
  }

  function drawFrame(frameNumber, pixelX, pixelY, options) {
    drawFrameTo(context, frameNumber, pixelX, pixelY, options);
  }

  function drawFrameAtGrid(frameNumber, gridX, gridY, options) {
    drawFrame(frameNumber, gridX * TILE_SIZE, gridY * TILE_SIZE, options);
  }

  function drawWall(gridX, gridY) {
    drawFrameAtGrid(TILE_CATALOG.wall, gridX, gridY);
    context.fillStyle = "rgba(3, 2, 7, 0.52)";
    context.fillRect(gridX * TILE_SIZE, gridY * TILE_SIZE + 12, TILE_SIZE, 4);
  }

  function drawObject(object, options = {}) {
    const definition = OBJECT_DEFINITIONS[object.type];
    if (!definition) return;
    drawFrameAtGrid(definition.frame, object.x, object.y, options);
  }

  function drawGrid() {
    context.save();
    context.strokeStyle = "rgba(224, 217, 233, 0.24)";
    context.lineWidth = 1;
    context.beginPath();
    for (let position = 0; position <= CANVAS_SIZE; position += TILE_SIZE) {
      context.moveTo(position + 0.5, 0);
      context.lineTo(position + 0.5, CANVAS_SIZE);
      context.moveTo(0, position + 0.5);
      context.lineTo(CANVAS_SIZE, position + 0.5);
    }
    context.stroke();
    context.restore();
  }

  function drawCollisionOverlay(stage, objects) {
    context.save();
    context.fillStyle = "rgba(184, 66, 89, 0.34)";
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (stage.tiles[y][x] === 2) context.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    objects.filter((object) => object.type === "doorClosed").forEach((object) => {
      context.fillRect(object.x * TILE_SIZE, object.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    });
    context.restore();
  }

  function render() {
    if (new URLSearchParams(location.search).get("atlas") === "1") return;
    const stage = currentStage();
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#080711";
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const tile = stage.tiles[y][x];
        if (tile === 2) drawWall(x, y);
        else drawFrameAtGrid(tile === 1 ? TILE_CATALOG.floorDetail : TILE_CATALOG.floor, x, y);
      }
    }

    if (state.mode === "edit") {
      stage.objects.forEach((object) => drawObject(object));
    } else {
      state.runtimeObjects.forEach((object) => drawObject(object));
      drawObject({ type: "sword", x: state.sword.x, y: state.sword.y });
      drawObject(
        { type: "player", x: state.player.x, y: state.player.y },
        { flipX: state.player.facing === "left" },
      );
    }

    const visibleObjects = state.mode === "edit" ? stage.objects : state.runtimeObjects;
    if (state.showCollision) drawCollisionOverlay(stage, visibleObjects);
    if (state.showGrid || state.mode === "edit") drawGrid();

    if (state.mode === "edit" && state.editorCursor) {
      context.save();
      context.strokeStyle = "#e4dc39";
      context.lineWidth = 2;
      context.strokeRect(
        state.editorCursor.x * TILE_SIZE + 1,
        state.editorCursor.y * TILE_SIZE + 1,
        TILE_SIZE - 2,
        TILE_SIZE - 2,
      );
      context.restore();
    }

    updateInterface();
  }

  function objectAt(x, y, objects = state.runtimeObjects) {
    return objects.find((object) => object.x === x && object.y === y);
  }

  function frontCell() {
    const direction = DIRECTIONS[state.player.facing];
    return { x: state.player.x + direction.x, y: state.player.y + direction.y };
  }

  function frontObject() {
    const front = frontCell();
    const object = objectAt(front.x, front.y);
    if (object) return object;
    if (state.sword.x === front.x && state.sword.y === front.y) return { type: "sword", ...front, properties: {} };
    return null;
  }

  function isBlocked(x, y) {
    if (!isInside(x, y)) return true;
    if (currentStage().tiles[y][x] === 2) return true;
    return state.runtimeObjects.some((object) => object.x === x && object.y === y && object.type === "doorClosed");
  }

  function movePlayer(directionName) {
    if (state.mode !== "play") return;
    const direction = DIRECTIONS[directionName];
    if (!direction) return;
    const now = performance.now();
    if (now - state.lastMoveAt < MOVE_COOLDOWN) return;
    state.lastMoveAt = now;
    state.player.facing = directionName;
    const targetX = state.player.x + direction.x;
    const targetY = state.player.y + direction.y;

    if (isBlocked(targetX, targetY)) {
      setLog("そこには進めません");
      render();
      return;
    }

    const previous = { x: state.player.x, y: state.player.y };
    state.player.x = targetX;
    state.player.y = targetY;
    state.sword = previous;
    setLog(`移動：${targetX}, ${targetY}`);
    render();
  }

  function inspectFront() {
    if (state.mode !== "play") {
      setLog("編集モードではCanvasをクリックして配置します");
      return;
    }
    const object = frontObject();
    const messages = {
      slime: "スライムを見つけた",
      boss: "ボスを見つけた",
      apple: "リンゴを見つけた",
      key: "鍵を見つけた",
      crown: "王冠を見つけた",
      doorClosed: "扉は閉じている",
      doorOpen: "扉は開いている",
      goal: "ゴール地点がある",
      marker: "調べられる場所がある",
      sword: "ソード君がいる",
    };
    setLog(object ? (messages[object.type] ?? `${OBJECT_DEFINITIONS[object.type]?.label ?? object.type}がある`) : "何もない");
    pulseButton(document.querySelector("#action-button"));
    updateDebugPanel();
  }

  function cancelAction() {
    setLog("キャンセル");
    pulseButton(document.querySelector("#cancel-button"));
  }

  function pulseButton(button) {
    button.classList.add("is-pressed");
    window.setTimeout(() => button.classList.remove("is-pressed"), 90);
  }

  function beginDirection(sourceId, directionName, button = null) {
    if (state.heldDirections.has(sourceId)) return;
    if (button) button.classList.add("is-pressed");
    movePlayer(directionName);
    const record = { button, delayTimer: null, intervalTimer: null };
    record.delayTimer = window.setTimeout(() => {
      movePlayer(directionName);
      record.intervalTimer = window.setInterval(() => movePlayer(directionName), HOLD_INTERVAL);
    }, HOLD_DELAY);
    state.heldDirections.set(sourceId, record);
  }

  function endDirection(sourceId) {
    const record = state.heldDirections.get(sourceId);
    if (!record) return;
    window.clearTimeout(record.delayTimer);
    window.clearInterval(record.intervalTimer);
    record.button?.classList.remove("is-pressed");
    state.heldDirections.delete(sourceId);
  }

  function stopAllDirections() {
    [...state.heldDirections.keys()].forEach(endDirection);
  }

  function selectedTool() {
    return EDITOR_TOOLS.find((tool) => tool.key === state.selectedTool) ?? EDITOR_TOOLS[1];
  }

  function buildEditorPalette() {
    const fragment = document.createDocumentFragment();
    EDITOR_TOOLS.forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-button";
      button.dataset.tool = tool.key;
      if (tool.key === state.selectedTool) button.classList.add("is-selected");

      if (tool.kind === "eraser") {
        const icon = document.createElement("span");
        icon.className = "eraser-icon";
        icon.textContent = "×";
        button.append(icon);
      } else {
        const preview = document.createElement("canvas");
        preview.width = TILE_SIZE;
        preview.height = TILE_SIZE;
        preview.dataset.frame = String(tool.frame);
        preview.dataset.wall = String(tool.key === "wall");
        button.append(preview);
      }

      const label = document.createElement("span");
      label.textContent = tool.label;
      button.append(label);
      button.addEventListener("click", () => selectEditorTool(tool.key));
      fragment.append(button);
    });
    editorPalette.replaceChildren(fragment);
    refreshPalettePreviews();
  }

  function refreshPalettePreviews() {
    editorPalette.querySelectorAll("canvas[data-frame]").forEach((preview) => {
      const previewContext = preview.getContext("2d");
      previewContext.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
      drawFrameTo(previewContext, Number(preview.dataset.frame), 0, 0);
      if (preview.dataset.wall === "true") {
        previewContext.fillStyle = "rgba(3, 2, 7, 0.52)";
        previewContext.fillRect(0, 12, TILE_SIZE, 4);
      }
    });
  }

  function selectEditorTool(toolKey) {
    state.selectedTool = toolKey;
    editorPalette.querySelectorAll(".palette-button").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.tool === toolKey);
    });
    setLog(`選択：${selectedTool().label}`);
    updateDebugPanel();
  }

  function eventToGridCell(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * GRID_SIZE);
    const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * GRID_SIZE);
    return isInside(x, y) ? { x, y } : null;
  }

  function paintCell(x, y) {
    const key = `${x},${y},${state.selectedTool}`;
    if (state.lastPaintedCell === key) return;
    state.lastPaintedCell = key;
    const stage = currentStage();
    const tool = selectedTool();

    if (tool.kind === "tile") {
      stage.tiles[y][x] = tool.tile;
    } else if (tool.kind === "eraser") {
      const before = stage.objects.length;
      stage.objects = stage.objects.filter((object) => object.x !== x || object.y !== y);
      if (before === stage.objects.length) stage.tiles[y][x] = 0;
    } else {
      if (["player", "sword"].includes(tool.type)) {
        stage.objects = stage.objects.filter((object) => object.type !== tool.type);
      }
      stage.objects = stage.objects.filter((object) => object.x !== x || object.y !== y);
      stage.objects.push({ type: tool.type, x, y, properties: {} });
    }

    state.editorCursor = { x, y };
    scheduleStorageSave();
    setLog(`${tool.label}を ${x}, ${y} に配置`);
    render();
  }

  function setMode(mode) {
    state.mode = mode;
    state.painting = false;
    state.lastPaintedCell = "";
    state.warpMode = false;
    stopAllDirections();
    if (mode === "play") {
      if (storageTimer !== null) saveStagesNow();
      createRuntimeFromStage();
      setLog("テストプレイを開始しました");
    } else {
      setLog("編集モード：パレットを選んで配置してください");
    }
    render();
  }

  function toggleEditMode() {
    setMode(state.mode === "play" ? "edit" : "play");
  }

  function toggleGrid() {
    state.showGrid = !state.showGrid;
    setLog(`グリッド表示：${state.showGrid ? "ON" : "OFF"}`);
    render();
  }

  function toggleCollision() {
    state.showCollision = !state.showCollision;
    setLog(`当たり判定表示：${state.showCollision ? "ON" : "OFF"}`);
    render();
  }

  function toggleWarpMode() {
    state.warpMode = !state.warpMode;
    if (state.mode === "edit") setMode("play");
    setLog(state.warpMode ? "WARP：Canvasの移動先をクリック" : "WARP：OFF");
    updateInterface();
  }

  function warpPlayer(x, y) {
    if (isBlocked(x, y)) {
      setLog("その位置にはワープできません");
      return;
    }
    state.sword = { x: state.player.x, y: state.player.y };
    state.player.x = x;
    state.player.y = y;
    setLog(`主人公を ${x}, ${y} へワープ`);
    render();
  }

  function openAllDoors() {
    if (state.mode === "edit") {
      currentStage().objects.forEach((object) => {
        if (object.type === "doorClosed") object.type = "doorOpen";
      });
      scheduleStorageSave();
    } else {
      state.runtimeObjects.forEach((object) => {
        if (object.type === "doorClosed") object.type = "doorOpen";
      });
    }
    setLog("閉じた扉をすべて開きました");
    render();
  }

  function serializeCurrentStage() {
    return JSON.stringify(currentStage(), null, 2);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // file: URL向けのフォールバックへ進みます。
      }
    }
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    return copied;
  }

  async function copyCurrentStageJson() {
    const json = serializeCurrentStage();
    jsonField.value = json;
    const copied = await copyText(json);
    setLog(copied ? "ステージJSONをコピーしました" : "JSON欄へ出力しました。手動でコピーしてください");
  }

  function importStageJson() {
    try {
      const parsed = JSON.parse(jsonField.value);
      const requestedCurrentId = currentStage().id;
      if (Array.isArray(parsed) || Array.isArray(parsed?.stages)) {
        workingStages = normalizeStages(Array.isArray(parsed) ? parsed : parsed.stages);
        currentStageIndex = Math.max(0, workingStages.findIndex((stage) => stage.id === requestedCurrentId));
      } else {
        const replacement = normalizeStage(parsed, currentStageIndex);
        workingStages[currentStageIndex] = replacement;
      }
      saveStagesNow();
      loadStage(currentStageIndex, "JSONからステージを読み込みました");
    } catch (error) {
      setLog(`JSONを読み込めません：${error.message}`);
    }
  }

  function restoreInitialData() {
    const currentId = currentStage().id;
    workingStages = deepClone(initialStages);
    currentStageIndex = Math.max(0, workingStages.findIndex((stage) => stage.id === currentId));
    saveStagesNow();
    loadStage(currentStageIndex, "編集内容を初期状態へ戻しました");
  }

  function displayPlayerForDebug() {
    if (state.mode === "play") return state.player;
    const player = currentStage().objects.find((object) => object.type === "player");
    return player ? { ...player, facing: "-" } : { x: "-", y: "-", facing: "-" };
  }

  function updateDebugPanel() {
    if (!currentStage()) return;
    const player = displayPlayerForDebug();
    const object = state.mode === "play" ? frontObject() : null;
    document.querySelector("#debug-stage-id").textContent = currentStage().id;
    document.querySelector("#debug-player-x").textContent = String(player.x);
    document.querySelector("#debug-player-y").textContent = String(player.y);
    document.querySelector("#debug-facing").textContent = player.facing;
    document.querySelector("#debug-mode").textContent = state.mode;
    document.querySelector("#debug-selected").textContent = selectedTool().label;
    document.querySelector("#debug-front-object").textContent = object ? OBJECT_DEFINITIONS[object.type]?.label ?? object.type : "なし";
    document.querySelector("#debug-storage").textContent = storageStatus;
  }

  function updateInterface() {
    stageLabelElement.textContent = `${currentStage().id} / ${currentStage().name}`;
    modeBadge.textContent = state.mode.toUpperCase();
    modeBadge.classList.toggle("is-editing", state.mode === "edit");
    editorPanel.hidden = state.mode !== "edit";
    const editButton = document.querySelector("#edit-button");
    editButton.setAttribute("aria-pressed", String(state.mode === "edit"));
    editButton.textContent = state.mode === "edit" ? "PLAY" : "EDIT";
    document.querySelector("#grid-button").setAttribute("aria-pressed", String(state.showGrid));
    document.querySelector("#collision-button").setAttribute("aria-pressed", String(state.showCollision));
    const warpButton = document.querySelector("#warp-button");
    warpButton.setAttribute("aria-pressed", String(state.warpMode));
    warpButton.textContent = `WARP: ${state.warpMode ? "ON" : "OFF"}`;
    updateDebugPanel();
  }

  function updateCanvasDisplaySize() {
    const available = Math.max(192, Math.min(document.documentElement.clientWidth - 8, 576));
    const integerScale = Math.floor(available / CANVAS_SIZE);
    const displaySize = integerScale >= 2 ? integerScale * CANVAS_SIZE : available;
    document.documentElement.style.setProperty("--game-display-size", `${displaySize}px`);
  }

  function buildAtlas() {
    if (atlasBuilt) return;
    atlasBuilt = true;
    const atlasGrid = document.querySelector("#atlas-grid");
    const catalogFrames = new Set(Object.values(TILE_CATALOG));
    const catalogNames = new Map(Object.entries(TILE_CATALOG).map(([name, frame]) => [frame, name]));
    const fragment = document.createDocumentFragment();

    for (let frame = 0; frame < ATLAS_FRAME_COUNT; frame += 1) {
      const figure = document.createElement("figure");
      figure.className = "atlas-item";
      figure.tabIndex = 0;
      figure.dataset.frame = String(frame);
      if (catalogFrames.has(frame)) {
        figure.classList.add("is-catalog");
        figure.title = `TILE_CATALOG.${catalogNames.get(frame)}`;
      }
      const preview = document.createElement("canvas");
      preview.width = TILE_SIZE;
      preview.height = TILE_SIZE;
      drawFrameTo(preview.getContext("2d"), frame, 0, 0);
      const caption = document.createElement("figcaption");
      caption.textContent = String(frame);
      figure.append(preview, caption);
      const copyFrame = async () => {
        const copied = await copyText(String(frame));
        document.querySelector("#atlas-status").textContent = copied
          ? `FRAME ${frame} をコピーしました${catalogNames.has(frame) ? ` // ${catalogNames.get(frame)}` : ""}`
          : `FRAME ${frame} を選択しました`;
      };
      figure.addEventListener("click", copyFrame);
      figure.addEventListener("keydown", (event) => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          copyFrame();
        }
      });
      fragment.append(figure);
    }
    atlasGrid.replaceChildren(fragment);
    document.querySelector("#atlas-status").textContent = tileSheetReady
      ? "1078フレームを表示中。クリックで番号をコピーします。黄色枠はTILE_CATALOG登録済みです。"
      : "colored.pngを読み込めなかったため、代替表示になっています。";
  }

  function initializeAtlasView() {
    gameApp.hidden = true;
    atlasView.hidden = false;
  }

  function bindControls() {
    document.querySelectorAll("[data-direction]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        beginDirection(`pointer:${event.pointerId}`, button.dataset.direction, button);
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
        button.addEventListener(eventName, (event) => endDirection(`pointer:${event.pointerId}`));
      });
      button.addEventListener("click", (event) => {
        if (event.detail === 0) movePlayer(button.dataset.direction);
      });
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    });

    document.querySelector("#action-button").addEventListener("click", inspectFront);
    document.querySelector("#cancel-button").addEventListener("click", cancelAction);
    document.querySelector("#reset-button").addEventListener("click", resetStage);
    document.querySelector("#debug-reset-button").addEventListener("click", resetStage);
    document.querySelector("#edit-button").addEventListener("click", toggleEditMode);
    document.querySelector("#test-play-button").addEventListener("click", () => setMode("play"));
    document.querySelector("#grid-button").addEventListener("click", toggleGrid);
    document.querySelector("#debug-grid-button").addEventListener("click", toggleGrid);
    document.querySelector("#collision-button").addEventListener("click", toggleCollision);
    document.querySelector("#warp-button").addEventListener("click", toggleWarpMode);
    document.querySelector("#open-doors-button").addEventListener("click", openAllDoors);
    document.querySelector("#previous-stage-button").addEventListener("click", () => changeStage(-1));
    document.querySelector("#next-stage-button").addEventListener("click", () => changeStage(1));
    document.querySelector("#debug-toggle-button").addEventListener("click", () => {
      debugPanel.open = !debugPanel.open;
      if (debugPanel.open) debugPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    document.querySelector("#debug-copy-button").addEventListener("click", copyCurrentStageJson);
    document.querySelector("#editor-copy-button").addEventListener("click", copyCurrentStageJson);
    document.querySelector("#load-json-button").addEventListener("click", importStageJson);
    document.querySelector("#restore-data-button").addEventListener("click", restoreInitialData);
    document.querySelector("#editor-restore-button").addEventListener("click", restoreInitialData);

    canvas.addEventListener("pointerdown", (event) => {
      const cell = eventToGridCell(event);
      if (!cell) return;
      if (state.mode === "edit") {
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        state.painting = true;
        state.lastPaintedCell = "";
        paintCell(cell.x, cell.y);
      } else if (state.warpMode) {
        event.preventDefault();
        warpPlayer(cell.x, cell.y);
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      const cell = eventToGridCell(event);
      if (state.mode === "edit") {
        state.editorCursor = cell;
        if (state.painting && cell) paintCell(cell.x, cell.y);
        else render();
      }
    });

    const finishPainting = () => {
      state.painting = false;
      state.lastPaintedCell = "";
    };
    canvas.addEventListener("pointerup", finishPainting);
    canvas.addEventListener("pointercancel", finishPainting);
    canvas.addEventListener("lostpointercapture", finishPainting);
    canvas.addEventListener("pointerleave", () => {
      if (!state.painting) {
        state.editorCursor = null;
        if (state.mode === "edit") render();
      }
    });

    window.addEventListener("keydown", (event) => {
      const active = event.target;
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active?.isContentEditable) return;
      if (active instanceof HTMLButtonElement && ["Enter", " "].includes(event.key)) return;

      const directionsByCode = {
        ArrowUp: "up", KeyW: "up",
        ArrowRight: "right", KeyD: "right",
        ArrowDown: "down", KeyS: "down",
        ArrowLeft: "left", KeyA: "left",
      };
      const direction = directionsByCode[event.code];
      if (direction) {
        event.preventDefault();
        beginDirection(`key:${event.code}`, direction);
        return;
      }
      if (event.repeat) return;

      if (["KeyZ", "Space"].includes(event.code)) {
        event.preventDefault();
        inspectFront();
      } else if (["KeyX", "Escape"].includes(event.code)) {
        event.preventDefault();
        cancelAction();
      } else if (event.code === "KeyR") {
        resetStage();
      } else if (event.code === "KeyE") {
        toggleEditMode();
      } else if (event.code === "KeyG") {
        toggleGrid();
      } else if (event.code === "KeyN") {
        changeStage(1);
      } else if (event.code === "KeyP") {
        changeStage(-1);
      }
    });

    window.addEventListener("keyup", (event) => endDirection(`key:${event.code}`));
    window.addEventListener("blur", stopAllDirections);
    window.addEventListener("resize", updateCanvasDisplaySize);
  }

  function initializeGame() {
    atlasView.hidden = true;
    gameApp.hidden = false;
    updateCanvasDisplaySize();
    buildEditorPalette();
    bindControls();
    loadStage(currentStageIndex, `${currentStage().name}：移動と調査をテストできます`);

    globalThis.ASIRIS_PROTOTYPE = Object.freeze({
      TILE_CATALOG,
      drawFrame,
      drawFrameAtGrid,
      getSnapshot: () => deepClone({
        stageId: currentStage().id,
        mode: state.mode,
        player: state.player,
        sword: state.sword,
        selectedTool: state.selectedTool,
        tileSheetReady,
        stage: currentStage(),
      }),
    });
  }

  tileSheet.addEventListener("load", () => {
    tileSheetReady = tileSheet.naturalWidth === 832 && tileSheet.naturalHeight === 373;
    assetStatus.textContent = tileSheetReady ? "TILESET READY" : "TILESET SIZE ERROR";
    assetStatus.classList.toggle("is-ready", tileSheetReady);
    assetStatus.classList.toggle("is-error", !tileSheetReady);
    if (new URLSearchParams(location.search).get("atlas") === "1") buildAtlas();
    else {
      refreshPalettePreviews();
      render();
    }
  });

  tileSheet.addEventListener("error", () => {
    tileSheetReady = false;
    assetStatus.textContent = "COLORED.PNG NOT FOUND";
    assetStatus.classList.add("is-error");
    if (new URLSearchParams(location.search).get("atlas") === "1") buildAtlas();
    else render();
  });

  tileSheet.src = "colored.png";
  if (new URLSearchParams(location.search).get("atlas") === "1") initializeAtlasView();
  else initializeGame();
})();
