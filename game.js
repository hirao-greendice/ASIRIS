"use strict";

// 盤面上の座標はすべて0始まりです。
const BOARD = Object.freeze({ columns: 11, rows: 19 });

const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1, angle: "0deg", label: "上" }),
  right: Object.freeze({ x: 1, y: 0, angle: "90deg", label: "右" }),
  down: Object.freeze({ x: 0, y: 1, angle: "180deg", label: "下" }),
  left: Object.freeze({ x: -1, y: 0, angle: "270deg", label: "左" }),
});

const BUTTON_STEP_DELAY = 160;
const ATTACK_DURATION = 260;
const PLAYER_MOVE_DURATION = 140;
const HOLD_REPEAT_DELAY = 320;
const HOLD_REPEAT_INTERVAL = 150;
const HERO_SPRITE_PATHS = Object.freeze(
  Object.keys(DIRECTIONS).flatMap((direction) => (
    ["idle", "attack"].map((pose) => `asset/hero-${direction}-${pose}.png`)
  )),
);
const HERO_SPRITE_CACHE = HERO_SPRITE_PATHS.map((path) => {
  const image = new Image();
  image.src = path;
  return image;
});

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

// UIも地形も、同じ11×19盤面上のオブジェクトとして定義します。
// 最終ギミックでは、これらの座標をそのまま床や壁として扱えます。
const SCREEN_OBJECTS = Object.freeze([
  {
    id: "play-zone",
    kind: "zone",
    x: 1,
    y: 2,
    width: 9,
    height: 9,
    label: "プレイエリア",
  },
  {
    id: "settings",
    kind: "button",
    action: "settings",
    x: 0,
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
    action: "stage-info",
    x: 2,
    y: 0,
    width: 7,
    height: 2,
    symbol: "1-1",
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
    y: 12,
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
    y: 14,
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
    y: 14,
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
    y: 16,
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
    y: 12,
    width: 2,
    height: 2,
    symbol: "A",
    label: "剣を振る",
  },
  {
    id: "undo",
    kind: "button",
    action: "undo",
    x: 8,
    y: 16,
    width: 2,
    height: 2,
    symbol: "U",
    label: "一手戻す",
  },
]);

// positionは、大きなワールド内で各11×19画面が並ぶ位置です。
// 同じ形式のオブジェクトを追加すれば、ステージ数を増やせます。
const STAGES = Object.freeze([
  {
    id: "knowledge-01",
    number: 1,
    position: { x: 0, y: 0 },
    start: { x: 3, y: 7, facing: "right" },
    holes: [],
    floor: [
      ...rect(2, 6, 4, 3),
      ...line(6, 7, 4),
    ],
    objects: [
      { id: "knowledge-01", kind: "knowledge", x: 6, y: 7, symbol: "知", label: "知識" },
      { id: "warp-01", kind: "warp", x: 9, y: 7, label: "ワープポイント" },
    ],
    hint: "「知」のマスに立ち、Aで知識を取得します。",
  },
  {
    id: "knowledge-02",
    number: 2,
    position: { x: 1, y: 0 },
    start: { x: 2, y: 5, facing: "down" },
    holes: [],
    floor: [
      ...line(2, 5, 7),
      ...line(8, 6, 3, "down"),
      ...line(9, 7, 1),
      ...line(4, 9, 5),
    ],
    objects: [
      { id: "knowledge-02", kind: "knowledge", x: 8, y: 9, symbol: "知", label: "知識" },
      { id: "warp-02", kind: "warp", x: 9, y: 7, label: "ワープポイント" },
    ],
    hint: "右へ進み、曲がった先を調べます。",
  },
  {
    id: "knowledge-03",
    number: 3,
    position: { x: 2, y: 0 },
    start: { x: 2, y: 7, facing: "right" },
    holes: [],
    floor: [
      ...rect(2, 6, 3, 3),
      ...line(5, 7, 5),
    ],
    objects: [
      { id: "warp-03", kind: "warp", x: 9, y: 7, label: "ワープポイント" },
    ],
    hint: "この画面も、ボタンも、すべて11×19の盤面上にあります。",
  },
]);

const stageElement = document.querySelector("#stage");

const state = {
  currentStageIndex: 0,
  player: null,
  history: [],
  collectedKnowledge: new Set(),
  message: "",
  manualInputSources: new Map(),
  buttonMotion: null,
  buttonMotionTimer: null,
  isAttacking: false,
  attackTimer: null,
  lastRenderedPlayer: null,
  directionRepeatTimers: new Map(),
  pressedControlSources: new Map(),
  warpArrivalKey: null,
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
    throw new Error(`${id} の座標が11×19の盤面外です。`);
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
  element.style.setProperty("--depth", object.y * 10);
  element.dataset.x = String(object.x);
  element.dataset.y = String(object.y);
  element.dataset.width = String(object.width ?? 1);
  element.dataset.height = String(object.height ?? 1);
  element.dataset.boardPart = "true";
}

function createLabeledContent(object) {
  const fragment = document.createDocumentFragment();

  if (object.id === "stage-number") {
    const copy = document.createElement("span");
    copy.className = "stage-number__copy";

    const label = document.createElement("span");
    label.className = "stage-number__label";
    label.textContent = "Stage";

    const value = document.createElement("span");
    value.className = "stage-number__value";
    value.textContent = object.symbol;

    copy.append(label, value);
    fragment.append(copy);
    return fragment;
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
    const isPressedByHero = state.player && containsCell(object, state.player.x, state.player.y);
    const isPressedByInput = [...state.pressedControlSources.values()].includes(object.action);
    if (isPressedByHero) {
      element.classList.add("is-player-pressed");
    }
    if (isPressedByInput) element.classList.add("is-input-pressed");
    element.setAttribute("aria-pressed", String(Boolean(isPressedByHero || isPressedByInput)));
  } else {
    element.setAttribute("aria-hidden", "true");
  }
  return element;
}

function createPanelTile(x, y) {
  const tile = document.createElement("div");
  tile.className = "stage-object stage-object--panel";
  const playZone = SCREEN_OBJECTS.find((object) => object.id === "play-zone");
  if (y + 1 < BOARD.rows && !containsCell(playZone, x, y + 1)) {
    tile.classList.add("has-tile-below");
  }
  tile.dataset.objectId = `panel-${x}-${y}`;
  tile.dataset.objectKind = "panel";
  tile.setAttribute("aria-hidden", "true");
  setGridArea(tile, { x, y });
  return tile;
}

function createSeaTile(x, y) {
  const tile = document.createElement("div");
  tile.className = "stage-object stage-object--sea";
  tile.dataset.objectId = `sea-${x}-${y}`;
  tile.dataset.objectKind = "sea";
  tile.setAttribute("aria-hidden", "true");
  setGridArea(tile, { x, y });
  return tile;
}

function createFloorTile(cell, index) {
  const tile = document.createElement("div");
  tile.className = "stage-object stage-object--tile";
  if (hasLandAt(cell.x, cell.y + 1)) tile.classList.add("has-tile-below");
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
  if (object.kind === "warp") {
    const sprite = document.createElement("img");
    sprite.className = "warp-point__sprite";
    sprite.src = "asset/warp-point.png";
    sprite.alt = "";
    sprite.draggable = false;
    entity.append(sprite);
  } else {
    entity.textContent = object.symbol;
  }
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
  player.dataset.facing = state.player.facing;
  player.dataset.pose = state.isAttacking ? "attack" : "idle";
  player.setAttribute("aria-label", "プレイヤー");
  setGridArea(player, state.player);

  const sprite = document.createElement("img");
  sprite.className = "player-sprite";
  sprite.src = `asset/hero-${state.player.facing}-${state.isAttacking ? "attack" : "idle"}.png`;
  sprite.alt = "";
  sprite.draggable = false;
  player.append(sprite);
  return player;
}

function animatePlayerFrom(previousPlayer) {
  if (!previousPlayer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (previousPlayer.stageIndex !== state.currentStageIndex) return;

  const deltaX = previousPlayer.x - state.player.x;
  const deltaY = previousPlayer.y - state.player.y;
  if (Math.abs(deltaX) + Math.abs(deltaY) !== 1) return;

  const player = stageElement.querySelector("#player");
  const stageBounds = stageElement.getBoundingClientRect();
  const fromX = deltaX * (stageBounds.width / BOARD.columns);
  const fromY = deltaY * (stageBounds.height / BOARD.rows);

  player.animate(
    [
      { transform: `translate(${fromX}px, ${fromY}px)` },
      { transform: "translate(0, 0)" },
    ],
    {
      duration: PLAYER_MOVE_DURATION,
      easing: "cubic-bezier(0.22, 0.8, 0.35, 1)",
    },
  );
}

function render() {
  const stage = currentStage();
  const fragment = document.createDocumentFragment();
  const playZone = SCREEN_OBJECTS.find((object) => object.id === "play-zone");
  const previousPlayer = state.lastRenderedPlayer
    ? { ...state.lastRenderedPlayer }
    : null;

  fragment.append(createScreenObject(playZone));

  for (let y = 0; y < BOARD.rows; y += 1) {
    for (let x = 0; x < BOARD.columns; x += 1) {
      if (containsCell(playZone, x, y)) fragment.append(createSeaTile(x, y));
      else fragment.append(createPanelTile(x, y));
    }
  }

  stage.floor.forEach((cell, index) => fragment.append(createFloorTile(cell, index)));
  stage.holes.forEach((cell, index) => fragment.append(createHole(cell, index)));
  SCREEN_OBJECTS
    .filter((object) => object.kind === "button")
    .forEach((object) => fragment.append(createScreenObject(object)));
  stage.objects
    .filter((object) => !state.collectedKnowledge.has(object.id))
    .forEach((object) => fragment.append(createEntity(object)));
  fragment.append(createPlayer());

  stageElement.replaceChildren(fragment);
  stageElement.dataset.stageId = stage.id;
  stageElement.dataset.worldX = String(stage.position.x);
  stageElement.dataset.worldY = String(stage.position.y);

  const number = stageElement.querySelector('[data-object-id="stage-number"] .stage-number__value');
  number.textContent = `${stage.number}-1`;
  animatePlayerFrom(previousPlayer);
  state.lastRenderedPlayer = {
    x: state.player.x,
    y: state.player.y,
    stageIndex: state.currentStageIndex,
  };

}

function loadStage(index, message = "") {
  const stage = STAGES[index];
  clearButtonMotion();
  clearAttack();
  clearDirectionRepeats();
  state.manualInputSources.clear();
  state.pressedControlSources.clear();
  state.warpArrivalKey = null;
  state.currentStageIndex = index;
  state.player = { ...stage.start };
  state.lastRenderedPlayer = null;
  state.history = [];
  state.message = message || `ステージ${stage.number}：矢印で移動します`;
  render();
}

function remember(player = state.player, stageIndex = state.currentStageIndex) {
  state.history.push({ stageIndex, player: { ...player } });
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

function refreshControlPressedStates() {
  stageElement.querySelectorAll(".stage-object--button[data-action]").forEach((element) => {
    const object = SCREEN_OBJECTS.find((candidate) => candidate.id === element.dataset.objectId);
    const isPressedByHero = Boolean(
      object && state.player && containsCell(object, state.player.x, state.player.y)
    );
    const isPressedByInput = [...state.pressedControlSources.values()].includes(element.dataset.action);
    element.classList.toggle("is-player-pressed", isPressedByHero);
    element.classList.toggle("is-input-pressed", isPressedByInput);
    element.setAttribute("aria-pressed", String(isPressedByHero || isPressedByInput));
  });
}

function pressControl(sourceId, action) {
  if (!action || state.pressedControlSources.get(sourceId) === action) return;
  state.pressedControlSources.set(sourceId, action);
  refreshControlPressedStates();
}

function releaseControl(sourceId) {
  if (!state.pressedControlSources.delete(sourceId)) return;
  refreshControlPressedStates();
}

function screenButtonAt(x, y) {
  return SCREEN_OBJECTS.find((object) => (
    object.kind === "button" && containsCell(object, x, y)
  ));
}

function isSeaCell(x, y) {
  const playZone = SCREEN_OBJECTS.find((object) => object.id === "play-zone");
  return containsCell(playZone, x, y);
}

function hasLandAt(x, y, stageIndex = state.currentStageIndex) {
  return STAGES[stageIndex].floor.some((cell) => cell.x === x && cell.y === y);
}

function isWalkable(x, y, stageIndex = state.currentStageIndex) {
  if (x < 0 || y < 0 || x >= BOARD.columns || y >= BOARD.rows) return false;
  if (STAGES[stageIndex].holes.some((hole) => hole.x === x && hole.y === y)) return false;
  return !isSeaCell(x, y) || hasLandAt(x, y, stageIndex);
}

function stageIndexAtWorldPosition(x, y) {
  return STAGES.findIndex((stage) => stage.position.x === x && stage.position.y === y);
}

function worldCell(stageIndex, cell) {
  const stage = STAGES[stageIndex];
  return {
    x: stage.position.x * BOARD.columns + cell.x,
    y: stage.position.y * BOARD.rows + cell.y,
  };
}

function warpKey(stageIndex, warp) {
  return `${STAGES[stageIndex].id}:${warp.id}`;
}

function warpAt(stageIndex, x, y) {
  return STAGES[stageIndex].objects.find((object) => (
    object.kind === "warp" && object.x === x && object.y === y
  ));
}

function nearestWarpInDirection(sourceStageIndex, sourceWarp, directionName) {
  const direction = DIRECTIONS[directionName];
  const sourceWorldCell = worldCell(sourceStageIndex, sourceWarp);
  const candidates = [];

  STAGES.forEach((stage, stageIndex) => {
    stage.objects
      .filter((object) => object.kind === "warp")
      .forEach((warp) => {
        const candidateWorldCell = worldCell(stageIndex, warp);
        const deltaX = candidateWorldCell.x - sourceWorldCell.x;
        const deltaY = candidateWorldCell.y - sourceWorldCell.y;
        const isSameLine = direction.x !== 0 ? deltaY === 0 : deltaX === 0;
        const distance = direction.x !== 0 ? deltaX * direction.x : deltaY * direction.y;

        if (isSameLine && distance > 0) {
          candidates.push({ stageIndex, warp, distance });
        }
      });
  });

  candidates.sort((first, second) => first.distance - second.distance);
  return candidates[0] ?? null;
}

function resolveWarpAfterMove(directionName) {
  const sourceStageIndex = state.currentStageIndex;
  const sourceWarp = warpAt(sourceStageIndex, state.player.x, state.player.y);

  if (!sourceWarp) {
    state.warpArrivalKey = null;
    return null;
  }

  const sourceKey = warpKey(sourceStageIndex, sourceWarp);
  if (state.warpArrivalKey === sourceKey) return null;

  const destination = nearestWarpInDirection(sourceStageIndex, sourceWarp, directionName);
  if (!destination) {
    state.warpArrivalKey = sourceKey;
    return { sourceWarp, destination: null };
  }

  state.currentStageIndex = destination.stageIndex;
  state.player.x = destination.warp.x;
  state.player.y = destination.warp.y;
  state.player.facing = directionName;
  state.warpArrivalKey = warpKey(destination.stageIndex, destination.warp);
  return { sourceWarp, destination };
}

function moveOneCell(directionName) {
  const direction = DIRECTIONS[directionName];
  let nextStageIndex = state.currentStageIndex;
  let nextX = state.player.x + direction.x;
  let nextY = state.player.y + direction.y;

  if (nextX < 0 || nextX >= BOARD.columns || nextY < 0 || nextY >= BOARD.rows) {
    const stagePosition = currentStage().position;
    const worldStageX = stagePosition.x + (nextX < 0 ? -1 : nextX >= BOARD.columns ? 1 : 0);
    const worldStageY = stagePosition.y + (nextY < 0 ? -1 : nextY >= BOARD.rows ? 1 : 0);
    nextStageIndex = stageIndexAtWorldPosition(worldStageX, worldStageY);
    if (nextStageIndex < 0) return false;

    if (nextX < 0) nextX = BOARD.columns - 1;
    else if (nextX >= BOARD.columns) nextX = 0;
    if (nextY < 0) nextY = BOARD.rows - 1;
    else if (nextY >= BOARD.rows) nextY = 0;
  }

  if (!isWalkable(nextX, nextY, nextStageIndex)) return false;
  state.currentStageIndex = nextStageIndex;
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

  const previousButton = screenButtonAt(state.player.x, state.player.y);
  const previousStageIndex = state.currentStageIndex;
  if (!moveOneCell(tileDirection)) {
    state.message = `${DIRECTIONS[tileDirection].label}ボタンの先へ進めません`;
    clearButtonMotion();
    render();
    return;
  }

  const warpResult = resolveWarpAfterMove(tileDirection);
  if (warpResult?.destination) {
    state.message = `ワープしてステージ${currentStage().number}へ移動しました`;
  } else if (state.currentStageIndex !== previousStageIndex) {
    state.message = `地続きのステージ${currentStage().number}へ移動しました`;
  } else {
    state.message = `${DIRECTIONS[tileDirection].label}ボタンで移動中`;
  }
  render();

  const nextButton = screenButtonAt(state.player.x, state.player.y);
  if (nextButton && nextButton.id !== previousButton?.id && !directionFromAction(nextButton.action)) {
    clearButtonMotion();
    runAction(nextButton.action);
    return;
  }

  const nextTileDirection = directionFromAction(nextButton?.action);
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

  const previousButton = screenButtonAt(state.player.x, state.player.y);
  const previousPlayer = { ...state.player };
  const previousStageIndex = state.currentStageIndex;
  state.player.facing = directionName;

  if (moveOneCell(directionName)) {
    remember(previousPlayer, previousStageIndex);
    const warpResult = resolveWarpAfterMove(directionName);
    if (warpResult?.destination) {
      state.message = `ワープしてステージ${currentStage().number}へ移動しました`;
    } else if (warpResult && !warpResult.destination) {
      state.message = `${DIRECTIONS[directionName].label}方向にワープポイントがありません`;
    } else if (state.currentStageIndex !== previousStageIndex) {
      state.message = `地続きのステージ${currentStage().number}へ移動しました`;
    } else {
      state.message = `${DIRECTIONS[directionName].label}へ移動しました`;
    }
  } else {
    state.message = "その先は盤面外または穴です";
  }
  render();

  const enteredButton = screenButtonAt(state.player.x, state.player.y);
  if (enteredButton && enteredButton.id !== previousButton?.id) {
    const enteredDirection = directionFromAction(enteredButton.action);
    if (!enteredDirection) {
      runAction(enteredButton.action);
      return;
    }

    // このマスへ入るために使った入力は消費済み。着地後の相殺には使いません。
    beginButtonMotion(true);
  }
}

function clearAttack() {
  if (state.attackTimer !== null) window.clearTimeout(state.attackTimer);
  state.attackTimer = null;
  state.isAttacking = false;
}

function clearDirectionRepeat(directionName) {
  const timer = state.directionRepeatTimers.get(directionName);
  if (timer !== undefined) window.clearTimeout(timer);
  state.directionRepeatTimers.delete(directionName);
}

function clearDirectionRepeats() {
  [...state.directionRepeatTimers.keys()].forEach(clearDirectionRepeat);
}

function hasActiveDirection(directionName) {
  return [...state.manualInputSources.values()].includes(directionName);
}

function scheduleDirectionRepeat(directionName, delay) {
  clearDirectionRepeat(directionName);
  const timer = window.setTimeout(() => {
    state.directionRepeatTimers.delete(directionName);
    if (!hasActiveDirection(directionName)) return;

    performManualMove(directionName);
    scheduleDirectionRepeat(directionName, HOLD_REPEAT_INTERVAL);
  }, delay);
  state.directionRepeatTimers.set(directionName, timer);
}

function startDirectionRepeat(directionName) {
  if (state.directionRepeatTimers.has(directionName)) return;
  scheduleDirectionRepeat(directionName, HOLD_REPEAT_DELAY);
}

function pressDirection(sourceId, directionName) {
  if (!DIRECTIONS[directionName] || state.manualInputSources.has(sourceId)) return;

  const directionWasAlreadyPressed = [...state.manualInputSources.values()].includes(directionName);
  state.manualInputSources.set(sourceId, directionName);

  if (!directionWasAlreadyPressed) startDirectionRepeat(directionName);
  if (!directionWasAlreadyPressed || directionButtonAt(state.player.x, state.player.y)) {
    performManualMove(directionName);
  }
}

function releaseDirection(sourceId) {
  if (!state.manualInputSources.has(sourceId)) return;
  const directionName = state.manualInputSources.get(sourceId);
  state.manualInputSources.delete(sourceId);
  state.buttonMotion?.ignoredSources.delete(sourceId);
  if (!hasActiveDirection(directionName)) clearDirectionRepeat(directionName);

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
  clearAttack();
  const previous = state.history.pop();
  if (!previous) {
    state.message = "これ以上戻せません";
    render();
    return;
  }
  state.currentStageIndex = previous.stageIndex;
  state.player = { ...previous.player };
  state.warpArrivalKey = null;
  state.lastRenderedPlayer = null;
  state.message = "一手戻しました";
  render();
}

function findInteractionTarget() {
  const stage = currentStage();
  const direction = DIRECTIONS[state.player.facing];
  const currentKey = cellKey(state.player.x, state.player.y);
  const frontKey = cellKey(state.player.x + direction.x, state.player.y + direction.y);

  return stage.objects.find((object) => {
    if (object.kind === "warp") return false;
    if (state.collectedKnowledge.has(object.id)) return false;
    const objectKey = cellKey(object.x, object.y);
    return objectKey === currentKey || objectKey === frontKey;
  });
}

function interact(missMessage = "近くに調べられるものはありません") {
  const target = findInteractionTarget();

  if (!target) {
    state.message = missMessage;
    render();
    return;
  }

  if (target.kind === "knowledge") {
    state.collectedKnowledge.add(target.id);
    state.message = "知識を取得しました";
    render();
    return;
  }

}

function attack() {
  if (state.attackTimer !== null) window.clearTimeout(state.attackTimer);
  state.isAttacking = true;
  state.attackTimer = window.setTimeout(() => {
    state.attackTimer = null;
    state.isAttacking = false;
    render();
  }, ATTACK_DURATION);

  // 剣を振った方向の現在地・1マス前を、従来のA判定として調べる。
  interact("剣を振りました");
}

function runAction(action) {
  if (action.startsWith("move-")) {
    move(action.slice(5));
    return;
  }

  const actions = {
    interact: attack,
    undo,
    hint: () => {
      state.message = currentStage().hint;
      render();
    },
    settings: () => {
      state.message = "設定画面は次の実装段階で追加できます";
      render();
    },
    "stage-info": () => {
      state.message = `現在地：ステージ${currentStage().number}`;
      render();
    },
  };

  actions[action]?.();
}

stageElement.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const sourceId = `pointer:${event.pointerId}`;
  pressControl(sourceId, button.dataset.action);
  const directionName = directionFromAction(button?.dataset.action);
  if (!directionName) return;

  event.preventDefault();
  try {
    stageElement.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic pointer events do not own an active pointer to capture.
  }
  pressDirection(sourceId, directionName);
});

function releasePointerDirection(event) {
  const sourceId = `pointer:${event.pointerId}`;
  releaseDirection(sourceId);
  releaseControl(sourceId);
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
  const sourceId = `key:${event.code || event.key}`;
  if (directionName) {
    event.preventDefault();
    if (!event.repeat) {
      pressControl(sourceId, `move-${directionName}`);
      pressDirection(sourceId, directionName);
    }
    return;
  }

  if (event.repeat) return;
  const focusedButton = event.target.closest?.("button[data-action]");
  if (["Enter", " "].includes(event.key) && focusedButton) {
    pressControl(sourceId, focusedButton.dataset.action);
    return;
  }

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
  pressControl(sourceId, action);
  runAction(action);
});

window.addEventListener("keyup", (event) => {
  const sourceId = `key:${event.code || event.key}`;
  if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
    releaseDirection(sourceId);
  }
  releaseControl(sourceId);
});

window.addEventListener("blur", () => {
  const sourceIds = [...state.manualInputSources.keys()];
  sourceIds.forEach(releaseDirection);
  state.pressedControlSources.clear();
  refreshControlPressedStates();
});

validateStageData();
loadStage(0, "矢印で移動し、知識のマスでAを押してください");
