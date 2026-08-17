"use strict";

// 盤面上の座標はすべて0始まりです。
const BOARD = Object.freeze({ columns: 12, rows: 21 });

const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1, angle: "0deg", label: "上" }),
  right: Object.freeze({ x: 1, y: 0, angle: "90deg", label: "右" }),
  down: Object.freeze({ x: 0, y: 1, angle: "180deg", label: "下" }),
  left: Object.freeze({ x: -1, y: 0, angle: "270deg", label: "左" }),
});

const BUTTON_STEP_DELAY = 160;

const rect = (x, y, width, height) => {
  const cells = [];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      cells.push({ x: column, y: row });
    }
  }
  return cells;
};

const line = (x, y, length, direction = "right") => {
  const vector = DIRECTIONS[direction];
  return Array.from({ length }, (_, index) => ({
    x: x + vector.x * index,
    y: y + vector.y * index,
  }));
};

// UIも地形も、同じ12×21盤面上のオブジェクトとして定義します。
// 最終ギミックでは、これらの座標をそのまま床や壁として扱えます。
const SCREEN_OBJECTS = Object.freeze([
  {
    id: "play-zone",
    kind: "zone",
    x: 1,
    y: 3,
    width: 10,
    height: 10,
    label: "プレイエリア",
  },
  {
    id: "settings",
    kind: "button",
    action: "settings",
    x: 1,
    y: 0,
    width: 2,
    height: 2,
    symbol: "",
    icon: "gear",
    label: "設定",
  },
  {
    id: "stage-number",
    kind: "button",
    action: "next-stage",
    x: 5,
    y: 0,
    width: 2,
    height: 2,
    symbol: "1",
    label: "ステージ",
    className: "stage-number",
  },
  {
    id: "hint",
    kind: "button",
    action: "hint",
    x: 9,
    y: 0,
    width: 2,
    height: 2,
    symbol: "?",
    label: "ヒント",
  },
  {
    id: "move-up",
    kind: "button",
    action: "move-up",
    x: 3,
    y: 14,
    width: 2,
    height: 2,
    symbol: "↑",
    label: "上へ移動",
    hideCaption: true,
    className: "control-button",
  },
  {
    id: "move-left",
    kind: "button",
    action: "move-left",
    x: 1,
    y: 16,
    width: 2,
    height: 2,
    symbol: "←",
    label: "左へ移動",
    hideCaption: true,
    className: "control-button",
  },
  {
    id: "move-right",
    kind: "button",
    action: "move-right",
    x: 5,
    y: 16,
    width: 2,
    height: 2,
    symbol: "→",
    label: "右へ移動",
    hideCaption: true,
    className: "control-button",
  },
  {
    id: "move-down",
    kind: "button",
    action: "move-down",
    x: 3,
    y: 18,
    width: 2,
    height: 2,
    symbol: "↓",
    label: "下へ移動",
    hideCaption: true,
    className: "control-button",
  },
  {
    id: "interact",
    kind: "button",
    action: "interact",
    x: 8,
    y: 14,
    width: 2,
    height: 2,
    symbol: "A",
    label: "調べる",
  },
  {
    id: "undo",
    kind: "button",
    action: "undo",
    x: 8,
    y: 18,
    width: 2,
    height: 2,
    symbol: "U",
    label: "一手戻す",
  },
]);

// positionは、大きなワールド内で各12×21ステージが並ぶ位置です。
// 同じ形式のオブジェクトを追加すれば、ステージ数を増やせます。
const STAGES = Object.freeze([
  {
    id: "knowledge-01",
    number: 1,
    position: { x: 0, y: 0 },
    start: { x: 3, y: 8, facing: "right" },
    holes: [],
    floor: [
      ...rect(2, 7, 4, 3),
      ...line(6, 8, 5),
    ],
    objects: [
      { id: "knowledge-01", kind: "knowledge", x: 6, y: 8, symbol: "知", label: "知識" },
      { id: "exit-01", kind: "exit", x: 10, y: 8, symbol: "門", label: "次のステージ" },
    ],
    hint: "「知」のマスに立ち、Aで知識を取得します。",
  },
  {
    id: "knowledge-02",
    number: 2,
    position: { x: 1, y: 0 },
    start: { x: 2, y: 6, facing: "down" },
    holes: [],
    floor: [
      ...line(2, 6, 7),
      ...line(8, 7, 3, "down"),
      ...line(4, 10, 5),
    ],
    objects: [
      { id: "knowledge-02", kind: "knowledge", x: 8, y: 10, symbol: "知", label: "知識" },
      { id: "exit-02", kind: "exit", x: 4, y: 10, symbol: "門", label: "次のステージ" },
    ],
    hint: "右へ進み、曲がった先を調べます。",
  },
  {
    id: "knowledge-03",
    number: 3,
    position: { x: 2, y: 0 },
    start: { x: 2, y: 8, facing: "right" },
    holes: [],
    floor: [
      ...rect(2, 7, 3, 3),
      ...line(5, 8, 6),
    ],
    objects: [
      { id: "goal-03", kind: "exit", x: 10, y: 8, symbol: "終", label: "仮のゴール" },
    ],
    hint: "この画面も、ボタンも、すべて12×21の盤面上にあります。",
  },
]);

const stageElement = document.querySelector("#stage");

const state = {
  currentStageIndex: 0,
  unlockedStageCount: 1,
  player: null,
  history: [],
  collectedKnowledge: new Set(),
  message: "",
  manualInputSources: new Map(),
  buttonMotion: null,
  buttonMotionTimer: null,
};

const cellKey = (x, y) => `${x},${y}`;
const currentStage = () => STAGES[state.currentStageIndex];

function assertArea({ id, x, y, width = 1, height = 1 }) {
  const valid = Number.isInteger(x)
    && Number.isInteger(y)
    && Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && x >= 0
    && y >= 0
    && x + width <= BOARD.columns
    && y + height <= BOARD.rows;

  if (!valid) {
    throw new Error(`${id} の座標が12×21の盤面外です。`);
  }
}

function validateStageData() {
  const ids = new Set();
  const positions = new Set();
  const screenObjectIds = new Set();

  SCREEN_OBJECTS.forEach((object) => {
    assertArea(object);
    if (screenObjectIds.has(object.id)) throw new Error(`画面オブジェクトID ${object.id} が重複しています。`);
    screenObjectIds.add(object.id);
  });

  STAGES.forEach((stage) => {
    if (ids.has(stage.id)) throw new Error(`ステージID ${stage.id} が重複しています。`);
    ids.add(stage.id);

    const positionKey = cellKey(stage.position.x, stage.position.y);
    if (positions.has(positionKey)) throw new Error(`ワールド座標 ${positionKey} が重複しています。`);
    positions.add(positionKey);

    assertArea({ id: `${stage.id}:start`, ...stage.start });
    stage.floor.forEach((cell, index) => assertArea({ id: `${stage.id}:floor-${index}`, ...cell }));
    stage.holes.forEach((cell, index) => assertArea({ id: `${stage.id}:hole-${index}`, ...cell }));
    stage.objects.forEach(assertArea);

    const floorCells = new Set(stage.floor.map((cell) => cellKey(cell.x, cell.y)));
    const holeCells = new Set(stage.holes.map((cell) => cellKey(cell.x, cell.y)));
    if (floorCells.size !== stage.floor.length) {
      throw new Error(`${stage.id} の床座標が重複しています。`);
    }
    if (holeCells.size !== stage.holes.length) {
      throw new Error(`${stage.id} の穴座標が重複しています。`);
    }
    if (holeCells.has(cellKey(stage.start.x, stage.start.y))) {
      throw new Error(`${stage.id} の開始位置を穴にはできません。`);
    }

    const objectIds = new Set();
    stage.objects.forEach((object) => {
      if (objectIds.has(object.id)) throw new Error(`${stage.id} のオブジェクトID ${object.id} が重複しています。`);
      objectIds.add(object.id);
      if (holeCells.has(cellKey(object.x, object.y))) {
        throw new Error(`${stage.id} の ${object.id} を穴には配置できません。`);
      }
    });
  });
}

function setGridArea(element, object) {
  element.style.setProperty("--column", object.x + 1);
  element.style.setProperty("--row", object.y + 1);
  element.style.setProperty("--width", object.width ?? 1);
  element.style.setProperty("--height", object.height ?? 1);
  element.dataset.x = String(object.x);
  element.dataset.y = String(object.y);
  element.dataset.width = String(object.width ?? 1);
  element.dataset.height = String(object.height ?? 1);
  element.dataset.boardPart = "true";
}

function createBoardCell(x, y) {
  const cell = document.createElement("span");
  cell.className = "board-cell";
  cell.style.gridColumn = String(x + 1);
  cell.style.gridRow = String(y + 1);
  cell.dataset.x = String(x);
  cell.dataset.y = String(y);
  cell.setAttribute("aria-hidden", "true");
  return cell;
}

function createLabeledContent(object) {
  const fragment = document.createDocumentFragment();
  const symbol = document.createElement("span");
  symbol.className = "stage-object__symbol";
  symbol.textContent = object.symbol;
  if (object.icon) {
    symbol.classList.add("stage-object__icon", `stage-object__icon--${object.icon}`);
  }
  symbol.setAttribute("aria-hidden", "true");
  fragment.append(symbol);

  if (!object.hideCaption) {
    const caption = document.createElement("span");
    caption.className = "stage-object__caption";
    caption.textContent = object.label;
    caption.setAttribute("aria-hidden", "true");
    fragment.append(caption);
  }
  return fragment;
}

function createScreenObject(object) {
  const interactive = object.kind === "button";
  const element = document.createElement(interactive ? "button" : "div");
  element.className = `stage-object stage-object--${object.kind}`;
  if (object.className) element.classList.add(object.className);
  element.dataset.objectId = object.id;
  element.dataset.objectKind = object.kind;
  setGridArea(element, object);

  if (interactive) {
    element.type = "button";
    element.dataset.action = object.action;
    element.setAttribute("aria-label", object.label);
    element.append(createLabeledContent(object));
  } else {
    element.textContent = object.label;
    element.setAttribute("aria-hidden", "true");
  }
  return element;
}

function createFloorTile(cell, index) {
  const tile = document.createElement("div");
  tile.className = "stage-object stage-object--tile";
  tile.dataset.objectId = `floor-${index}`;
  tile.dataset.objectKind = "floor";
  tile.setAttribute("aria-hidden", "true");
  setGridArea(tile, cell);
  return tile;
}

function createHole(cell, index) {
  const hole = document.createElement("div");
  hole.className = "stage-object stage-object--hole";
  hole.dataset.objectId = `hole-${index}`;
  hole.dataset.objectKind = "hole";
  hole.textContent = "×";
  hole.setAttribute("aria-label", "穴");
  setGridArea(hole, cell);
  return hole;
}

function createEntity(object) {
  const entity = document.createElement("div");
  entity.className = "stage-object stage-object--entity";
  entity.dataset.objectId = object.id;
  entity.dataset.objectKind = object.kind;
  entity.textContent = object.symbol;
  entity.title = object.label;
  entity.setAttribute("aria-label", object.label);
  setGridArea(entity, object);
  return entity;
}

function createPlayer() {
  const player = document.createElement("div");
  player.id = "player";
  player.className = "stage-object stage-object--player";
  player.dataset.objectId = "player";
  player.dataset.objectKind = "player";
  player.textContent = "人";
  player.setAttribute("aria-label", "プレイヤー");
  setGridArea(player, state.player);
  player.style.setProperty("--facing-angle", DIRECTIONS[state.player.facing].angle);
  return player;
}

function render() {
  const stage = currentStage();
  const fragment = document.createDocumentFragment();

  for (let y = 0; y < BOARD.rows; y += 1) {
    for (let x = 0; x < BOARD.columns; x += 1) {
      fragment.append(createBoardCell(x, y));
    }
  }

  SCREEN_OBJECTS.forEach((object) => fragment.append(createScreenObject(object)));
  stage.floor.forEach((cell, index) => fragment.append(createFloorTile(cell, index)));
  stage.holes.forEach((cell, index) => fragment.append(createHole(cell, index)));
  stage.objects
    .filter((object) => !state.collectedKnowledge.has(object.id))
    .forEach((object) => fragment.append(createEntity(object)));
  fragment.append(createPlayer());

  stageElement.replaceChildren(fragment);
  stageElement.dataset.stageId = stage.id;
  stageElement.dataset.worldX = String(stage.position.x);
  stageElement.dataset.worldY = String(stage.position.y);

  const number = stageElement.querySelector('[data-object-id="stage-number"] .stage-object__symbol');
  number.textContent = String(stage.number);

}

function loadStage(index, message = "") {
  const stage = STAGES[index];
  clearButtonMotion();
  state.manualInputSources.clear();
  state.currentStageIndex = index;
  state.player = { ...stage.start };
  state.history = [];
  state.message = message || `ステージ${stage.number}：矢印で移動します`;
  render();
}

function remember() {
  state.history.push({ ...state.player });
  if (state.history.length > 200) state.history.shift();
}

function containsCell(object, x, y) {
  return x >= object.x
    && y >= object.y
    && x < object.x + (object.width ?? 1)
    && y < object.y + (object.height ?? 1);
}

function directionFromAction(action) {
  if (!action?.startsWith("move-")) return null;
  const directionName = action.slice(5);
  return DIRECTIONS[directionName] ? directionName : null;
}

function directionButtonAt(x, y) {
  const button = SCREEN_OBJECTS.find((object) => (
    object.kind === "button"
    && directionFromAction(object.action)
    && containsCell(object, x, y)
  ));
  return button ? directionFromAction(button.action) : null;
}

function isWalkable(x, y) {
  if (x < 0 || y < 0 || x >= BOARD.columns || y >= BOARD.rows) return false;
  return !currentStage().holes.some((hole) => hole.x === x && hole.y === y);
}

function moveOneCell(directionName) {
  const direction = DIRECTIONS[directionName];
  const nextX = state.player.x + direction.x;
  const nextY = state.player.y + direction.y;
  if (!isWalkable(nextX, nextY)) return false;
  state.player.x = nextX;
  state.player.y = nextY;
  state.player.facing = directionName;
  return true;
}

function activeManualDirections() {
  const ignoredSources = state.buttonMotion?.ignoredSources ?? new Set();
  return new Set(
    [...state.manualInputSources.entries()]
      .filter(([sourceId]) => !ignoredSources.has(sourceId))
      .map(([, directionName]) => directionName),
  );
}

function hasDirectionConflict(tileDirection) {
  const directions = activeManualDirections();
  directions.add(tileDirection);
  return directions.size > 1;
}

function clearButtonMotion() {
  if (state.buttonMotionTimer !== null) {
    window.clearTimeout(state.buttonMotionTimer);
  }
  state.buttonMotionTimer = null;
  state.buttonMotion = null;
}

function scheduleButtonMotion() {
  if (!state.buttonMotion || state.buttonMotionTimer !== null) return;
  state.buttonMotionTimer = window.setTimeout(() => {
    state.buttonMotionTimer = null;
    advanceButtonMotion();
  }, BUTTON_STEP_DELAY);
}

function beginButtonMotion(ignoreCurrentSources) {
  const tileDirection = directionButtonAt(state.player.x, state.player.y);
  if (!tileDirection) {
    clearButtonMotion();
    return;
  }

  state.buttonMotion = {
    direction: tileDirection,
    ignoredSources: ignoreCurrentSources
      ? new Set(state.manualInputSources.keys())
      : new Set(),
  };
  scheduleButtonMotion();
}

function advanceButtonMotion() {
  const tileDirection = directionButtonAt(state.player.x, state.player.y);
  if (!tileDirection) {
    clearButtonMotion();
    return;
  }

  if (!state.buttonMotion) beginButtonMotion(false);
  state.buttonMotion.direction = tileDirection;

  if (hasDirectionConflict(tileDirection)) {
    state.message = "異なる方向が同時に押されているため停止中";
    scheduleButtonMotion();
    return;
  }

  if (!moveOneCell(tileDirection)) {
    state.message = `${DIRECTIONS[tileDirection].label}ボタンの先へ進めません`;
    clearButtonMotion();
    render();
    return;
  }

  state.message = `${DIRECTIONS[tileDirection].label}ボタンで移動中`;
  render();

  const nextTileDirection = directionButtonAt(state.player.x, state.player.y);
  if (!nextTileDirection) {
    clearButtonMotion();
    return;
  }
  state.buttonMotion.direction = nextTileDirection;
  scheduleButtonMotion();
}

function performManualMove(directionName) {
  const tileDirection = directionButtonAt(state.player.x, state.player.y);

  if (tileDirection) {
    if (!state.buttonMotion) beginButtonMotion(false);
    if (hasDirectionConflict(tileDirection)) {
      state.message = "異なる方向が同時に押されているため停止中";
      render();
    } else {
      scheduleButtonMotion();
    }
    return;
  }

  if (activeManualDirections().size > 1) {
    state.message = "異なる方向が同時に押されているため停止中";
    render();
    return;
  }

  remember();
  state.player.facing = directionName;

  if (moveOneCell(directionName)) {
    state.message = `${DIRECTIONS[directionName].label}へ移動しました`;
  } else {
    state.message = "その先は盤面外または穴です";
  }
  render();

  if (directionButtonAt(state.player.x, state.player.y)) {
    // このマスへ入るために使った入力は消費済み。着地後の相殺には使いません。
    beginButtonMotion(true);
  }
}

function pressDirection(sourceId, directionName) {
  if (!DIRECTIONS[directionName] || state.manualInputSources.has(sourceId)) return;

  const directionWasAlreadyPressed = [...state.manualInputSources.values()].includes(directionName);
  state.manualInputSources.set(sourceId, directionName);

  if (!directionWasAlreadyPressed || directionButtonAt(state.player.x, state.player.y)) {
    performManualMove(directionName);
  }
}

function releaseDirection(sourceId) {
  if (!state.manualInputSources.has(sourceId)) return;
  state.manualInputSources.delete(sourceId);
  state.buttonMotion?.ignoredSources.delete(sourceId);

  if (directionButtonAt(state.player.x, state.player.y)) {
    if (state.buttonMotionTimer !== null) window.clearTimeout(state.buttonMotionTimer);
    state.buttonMotionTimer = null;
    if (!state.buttonMotion) beginButtonMotion(false);
    else scheduleButtonMotion();
  }
}

let virtualInputId = 0;
function tapDirection(directionName) {
  virtualInputId += 1;
  const sourceId = `tap:${virtualInputId}`;
  pressDirection(sourceId, directionName);
  releaseDirection(sourceId);
}

function move(directionName) {
  tapDirection(directionName);
}

function undo() {
  clearButtonMotion();
  const previous = state.history.pop();
  if (!previous) {
    state.message = "これ以上戻せません";
    render();
    return;
  }
  state.player = previous;
  state.message = "一手戻しました";
  render();
}

function findInteractionTarget() {
  const stage = currentStage();
  const direction = DIRECTIONS[state.player.facing];
  const currentKey = cellKey(state.player.x, state.player.y);
  const frontKey = cellKey(state.player.x + direction.x, state.player.y + direction.y);

  return stage.objects.find((object) => {
    if (state.collectedKnowledge.has(object.id)) return false;
    const objectKey = cellKey(object.x, object.y);
    return objectKey === currentKey || objectKey === frontKey;
  });
}

function interact() {
  const target = findInteractionTarget();

  if (!target) {
    state.message = "近くに調べられるものはありません";
    render();
    return;
  }

  if (target.kind === "knowledge") {
    state.collectedKnowledge.add(target.id);
    state.unlockedStageCount = Math.min(
      STAGES.length,
      Math.max(state.unlockedStageCount, state.currentStageIndex + 2),
    );
    state.message = state.currentStageIndex + 1 < STAGES.length
      ? `知識を取得。ステージ${state.currentStageIndex + 2}を解放しました`
      : "知識を取得しました";
    render();
    return;
  }

  if (target.kind === "exit") {
    const nextIndex = state.currentStageIndex + 1;
    if (nextIndex < state.unlockedStageCount && nextIndex < STAGES.length) {
      loadStage(nextIndex, `ステージ${STAGES[nextIndex].number}へ移動しました`);
    } else if (nextIndex >= STAGES.length) {
      state.message = "ここが現在の仮ゴールです";
      render();
    } else {
      state.message = "先へ進むには、この画面の知識が必要です";
      render();
    }
  }
}

function showNextUnlockedStage() {
  const nextIndex = (state.currentStageIndex + 1) % state.unlockedStageCount;
  if (nextIndex === state.currentStageIndex) {
    state.message = "まだ次のステージは解放されていません";
    render();
    return;
  }
  loadStage(nextIndex);
}

function runAction(action) {
  if (action.startsWith("move-")) {
    move(action.slice(5));
    return;
  }

  const actions = {
    interact,
    undo,
    hint: () => {
      state.message = currentStage().hint;
      render();
    },
    settings: () => {
      state.message = "設定画面は次の実装段階で追加できます";
      render();
    },
    "next-stage": showNextUnlockedStage,
  };

  actions[action]?.();
}

stageElement.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-action]");
  const directionName = directionFromAction(button?.dataset.action);
  if (!directionName) return;

  event.preventDefault();
  stageElement.setPointerCapture?.(event.pointerId);
  pressDirection(`pointer:${event.pointerId}`, directionName);
});

function releasePointerDirection(event) {
  releaseDirection(`pointer:${event.pointerId}`);
}

window.addEventListener("pointerup", releasePointerDirection);
window.addEventListener("pointercancel", releasePointerDirection);

stageElement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const directionName = directionFromAction(button.dataset.action);
  if (directionName) {
    // マウス・タッチはpointerdownで処理済み。キーボード操作とelement.click()だけ補います。
    if (event.detail === 0) tapDirection(directionName);
    return;
  }
  runAction(button.dataset.action);
});

window.addEventListener("keydown", (event) => {
  const keyDirections = {
    ArrowUp: "up",
    ArrowRight: "right",
    ArrowDown: "down",
    ArrowLeft: "left",
  };
  const directionName = keyDirections[event.key];
  if (directionName) {
    event.preventDefault();
    if (!event.repeat) pressDirection(`key:${event.key}`, directionName);
    return;
  }

  if (event.repeat) return;
  if (["Enter", " "].includes(event.key) && event.target.closest?.("button")) return;

  const keyActions = {
    a: "interact",
    A: "interact",
    Enter: "interact",
    " ": "interact",
    u: "undo",
    U: "undo",
    z: "undo",
    Z: "undo",
  };
  const action = keyActions[event.key];
  if (!action) return;
  event.preventDefault();
  runAction(action);
});

window.addEventListener("keyup", (event) => {
  if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
    releaseDirection(`key:${event.key}`);
  }
});

window.addEventListener("blur", () => {
  const sourceIds = [...state.manualInputSources.keys()];
  sourceIds.forEach(releaseDirection);
});

validateStageData();
loadStage(0, "矢印で移動し、知識のマスでAを押してください");
