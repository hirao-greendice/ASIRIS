"use strict";

// 盤面上の座標はすべて0始まりです。
const BOARD = Object.freeze({ columns: 11, rows: 19 });

const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1, angle: "0deg", label: "上" }),
  right: Object.freeze({ x: 1, y: 0, angle: "90deg", label: "右" }),
  down: Object.freeze({ x: 0, y: 1, angle: "180deg", label: "下" }),
  left: Object.freeze({ x: -1, y: 0, angle: "270deg", label: "左" }),
});

const BUTTON_STEP_DELAY = 240;
const ATTACK_DURATION = 260;
const PLAYER_MOVE_DURATION = 210;
const HOLD_REPEAT_DELAY = 380;
const HOLD_REPEAT_INTERVAL = 240;
const UNDO_REPEAT_DELAY = 440;
const UNDO_REPEAT_INTERVAL = 220;
const ENVIRONMENT_FLIP_INTERVAL = 1600;
const WARP_ACTIVATION_DELAY = 300;
const WARP_EXIT_DELAY = 300;
const FOOTSTEP_SNIPPET_DURATION = 500;
const SLIME_SPRITE_PATH = "22283729.png";
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
const slimeSprite = new Image();
slimeSprite.src = SLIME_SPRITE_PATH;

function createSoundEffect(path, volume) {
  const audio = new Audio(path);
  audio.preload = "auto";
  audio.volume = volume;
  return audio;
}

const footstepAudio = createSoundEffect("asset/footstep.mp3", 0.65);
const warpAudio = createSoundEffect("asset/warp.mp3", 0.7);
let footstepStopTimer = null;
let soundEffectsUnlocked = false;

function unlockSoundEffects() {
  if (soundEffectsUnlocked) return;
  soundEffectsUnlocked = true;
  const wasMuted = warpAudio.muted;
  warpAudio.muted = true;

  const finishUnlock = () => {
    warpAudio.pause();
    try {
      warpAudio.currentTime = 0;
    } catch {
      // Metadata may not be ready during the first interaction.
    }
    warpAudio.muted = wasMuted;
  };

  const playback = warpAudio.play();
  if (playback?.then) {
    playback.then(finishUnlock).catch(() => {
      soundEffectsUnlocked = false;
      finishUnlock();
    });
  } else {
    window.setTimeout(finishUnlock, 0);
  }
}

function restartSound(audio) {
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // Metadata may not be ready on the very first input.
  }
  const playback = audio.play();
  playback?.catch(() => {
    // Browsers can reject playback until the first user interaction.
  });
}

function playFootstepSound() {
  if (footstepStopTimer !== null) window.clearTimeout(footstepStopTimer);
  restartSound(footstepAudio);
  footstepStopTimer = window.setTimeout(() => {
    footstepAudio.pause();
    footstepStopTimer = null;
  }, FOOTSTEP_SNIPPET_DURATION);
}

function playWarpSound() {
  restartSound(warpAudio);
}

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

const directionObject = (id, x, y, direction) => Object.freeze({
  id,
  kind: "direction",
  action: `move-${direction}`,
  direction,
  x,
  y,
  label: `${DIRECTIONS[direction].label}へ進む矢印`,
});

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
// デザイン案のStage 1-1からStage 7-1までを実装しています。
const STAGES = Object.freeze([
  {
    id: "stage-01",
    number: 1,
    position: { x: 0, y: 0 },
    entryWarpId: null,
    exitWarpId: "warp-01-out",
    exitDirection: "right",
    start: { x: 3, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...line(1, 3, 2),
      ...rect(6, 3, 3, 2),
      ...rect(2, 5, 3, 3),
      ...line(5, 6, 4),
      ...line(3, 9, 2),
      ...rect(7, 8, 2, 2),
    ],
    objects: [
      { id: "warp-01-upper", kind: "warp", x: 2, y: 3, label: "上側のワープポイント" },
      { id: "warp-01-out", kind: "warp", x: 8, y: 6, label: "Stage 2-1へのワープポイント" },
    ],
    hint: "右側のワープポイントを目指しましょう。",
  },
  {
    id: "stage-02",
    number: 2,
    position: { x: 1, y: 0 },
    entryWarpId: "warp-02-in",
    exitWarpId: "warp-02-out",
    exitDirection: "right",
    start: { x: 3, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...line(2, 6, 7),
    ],
    objects: [
      { id: "warp-02-in", kind: "warp", x: 2, y: 6, label: "Stage 1-1へのワープポイント" },
      { id: "slime-02", kind: "slime", x: 5, y: 6, label: "スライム" },
      { id: "warp-02-out", kind: "warp", x: 8, y: 6, label: "右側のワープポイント" },
    ],
    hint: "スライムをAで倒し、右側のワープポイントまで進みましょう。",
  },
  {
    id: "stage-03",
    number: 3,
    position: { x: 2, y: 0 },
    entryWarpId: "warp-03-in",
    exitWarpId: "warp-03-out",
    exitDirection: "right",
    start: { x: 3, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...line(2, 6, 7),
      ...rect(6, 7, 2, 3),
    ],
    objects: [
      { id: "warp-03-in", kind: "warp", x: 2, y: 6, label: "Stage 2-1へのワープポイント" },
      { id: "slime-03", kind: "slime", x: 5, y: 6, label: "スライム" },
      { id: "warp-03-out", kind: "warp", x: 8, y: 6, label: "Stage 4-1へのワープポイント" },
      { id: "warp-03-lower", kind: "warp", x: 7, y: 8, label: "下側のワープポイント" },
    ],
    hint: "横道だけでなく、下側のワープポイントも調べてみましょう。",
  },
  {
    id: "stage-04",
    number: 4,
    position: { x: 3, y: 0 },
    entryWarpId: "warp-04-in",
    exitWarpId: "warp-04-out",
    exitDirection: "right",
    start: { x: 3, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...line(2, 6, 7),
      ...rect(6, 7, 2, 3),
    ],
    objects: [
      { id: "warp-04-in", kind: "warp", x: 2, y: 6, label: "Stage 3-1へのワープポイント" },
      { id: "slime-04", kind: "slime", x: 5, y: 6, label: "スライム" },
      { id: "warp-04-out", kind: "warp", x: 8, y: 6, label: "Stage 5-1へのワープポイント" },
      { id: "warp-04-lower", kind: "warp", x: 7, y: 8, label: "下側のワープポイント" },
    ],
    hint: "右側のワープポイントから次へ進めます。",
  },
  {
    id: "stage-05",
    number: 5,
    position: { x: 4, y: 0 },
    entryWarpId: "warp-05-in",
    exitWarpId: "warp-05-out",
    exitDirection: "up",
    start: { x: 3, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...rect(3, 3, 2, 7),
      ...rect(6, 4, 3, 6),
      { x: 2, y: 6 },
      { x: 2, y: 8 },
      { x: 8, y: 3 },
    ],
    objects: [
      { id: "warp-05-in", kind: "warp", x: 2, y: 6, label: "Stage 4-1へのワープポイント" },
      { id: "warp-05-lower", kind: "warp", x: 2, y: 8, label: "左下のワープポイント" },
      { id: "warp-05-out", kind: "warp", x: 8, y: 3, label: "Stage 6-1へのワープポイント" },
      { id: "boss-05", kind: "boss", x: 7, y: 5, label: "魔王" },
    ],
    hint: "右上のワープポイントは、上へ入ると次のステージにつながります。",
  },
  {
    id: "stage-06",
    number: 6,
    position: { x: 4, y: -1 },
    entryWarpId: "warp-06-main",
    exitWarpId: "warp-06-main",
    exitDirection: "right",
    start: { x: 4, y: 3, facing: "down" },
    holes: [],
    floor: [
      ...rect(2, 3, 7, 7),
    ],
    objects: [
      { id: "warp-06-left", kind: "warp", x: 2, y: 6, label: "左側のワープポイント" },
      { id: "warp-06-main", kind: "warp", x: 8, y: 6, label: "Stage 5-1・7-1につながるワープポイント" },
      directionObject("arrow-06-01", 6, 4, "right"),
      directionObject("arrow-06-02", 8, 4, "down"),
      directionObject("arrow-06-03", 3, 5, "right"),
      directionObject("arrow-06-04", 5, 5, "down"),
      directionObject("arrow-06-05", 7, 5, "left"),
      directionObject("arrow-06-06", 4, 6, "left"),
      directionObject("arrow-06-07", 6, 6, "up"),
      directionObject("arrow-06-08", 3, 7, "up"),
      directionObject("arrow-06-09", 5, 7, "right"),
      directionObject("arrow-06-10", 7, 7, "down"),
      directionObject("arrow-06-11", 2, 8, "right"),
      directionObject("arrow-06-12", 4, 8, "down"),
      directionObject("arrow-06-13", 6, 8, "left"),
      directionObject("arrow-06-14", 2, 9, "up"),
      directionObject("arrow-06-15", 3, 9, "left"),
      directionObject("arrow-06-16", 5, 9, "up"),
      directionObject("arrow-06-17", 6, 9, "right"),
      directionObject("arrow-06-18", 7, 9, "left"),
      directionObject("arrow-06-19", 8, 9, "down"),
    ],
    hint: "小さな矢印を踏むと、その矢印が勇者を動かします。",
  },
  {
    id: "stage-07",
    number: 7,
    position: { x: 5, y: -1 },
    entryWarpId: "warp-07-in",
    exitWarpId: null,
    exitDirection: null,
    start: { x: 4, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...rect(2, 3, 7, 7),
    ],
    objects: [
      { id: "warp-07-in", kind: "warp", x: 2, y: 6, label: "Stage 6-1へのワープポイント" },
      directionObject("arrow-07-right", 3, 6, "right"),
      { id: "boss-07", kind: "boss", x: 4, y: 14, label: "画面の外にいる魔王" },
    ],
    hint: "盤面の中だけがステージとは限りません。",
  },
  {
    id: "stage-04-2",
    number: 4,
    substage: 2,
    position: { x: 3, y: -1 },
    entryWarpId: "warp-04-2-lower",
    exitWarpId: "warp-04-2-lower",
    exitDirection: "up",
    start: { x: 3, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...line(2, 6, 7),
      ...rect(6, 7, 2, 3),
    ],
    objects: [
      { id: "warp-04-2-in", kind: "warp", x: 2, y: 6, label: "左側のワープポイント" },
      { id: "slime-04-2", kind: "slime", x: 5, y: 6, label: "スライム" },
      { id: "warp-04-2-out", kind: "warp", x: 8, y: 6, label: "右側のワープポイント" },
      { id: "warp-04-2-lower", kind: "warp", x: 7, y: 8, label: "Stage 4-1・4-3につながるワープポイント" },
    ],
    hint: "Stage 4-1とほぼ同じですが、上にもステージが続いています。",
  },
  {
    id: "stage-04-3",
    number: 4,
    substage: 3,
    position: { x: 3, y: -2 },
    entryWarpId: "warp-04-3-lower",
    exitWarpId: null,
    exitDirection: null,
    screenObjectOverrides: {
      interact: { x: 9 },
      undo: { x: 9 },
    },
    start: { x: 3, y: 6, facing: "right" },
    holes: [],
    floor: [
      ...line(2, 6, 7),
      ...rect(6, 7, 2, 3),
    ],
    objects: [
      { id: "warp-04-3-in", kind: "warp", x: 2, y: 6, label: "左側のワープポイント" },
      { id: "slime-04-3", kind: "slime", x: 5, y: 6, label: "スライム" },
      { id: "warp-04-3-out", kind: "warp", x: 8, y: 6, label: "右側のワープポイント" },
      { id: "warp-04-3-lower", kind: "warp", x: 7, y: 8, label: "Stage 4-2へのワープポイント" },
    ],
    hint: "AとUの位置が、これまでの画面と少し違います。",
  },
]);

const stageElement = document.querySelector("#stage");
let environmentFlipTimer = null;

function startEnvironmentAnimation() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (environmentFlipTimer !== null) window.clearInterval(environmentFlipTimer);

  environmentFlipTimer = window.setInterval(() => {
    stageElement.classList.toggle("is-environment-flipped");
  }, ENVIRONMENT_FLIP_INTERVAL);
}

const state = {
  currentStageIndex: 0,
  player: null,
  history: [],
  defeatedEnemies: new Set(),
  message: "",
  manualInputSources: new Map(),
  buttonMotion: null,
  buttonMotionTimer: null,
  isAttacking: false,
  attackTimer: null,
  lastRenderedPlayer: null,
  directionRepeatTimers: new Map(),
  activeUndoSources: new Set(),
  undoRepeatTimers: new Map(),
  pressedControlSources: new Map(),
  activeDirectionPointerSources: new Set(),
  warpArrivalKey: null,
  pendingWarpExit: null,
  warpExitTimer: null,
};

const cellKey = (x, y) => `${x},${y}`;
const currentStage = () => STAGES[state.currentStageIndex];
const stageLabel = (stage) => `${stage.number}-${stage.substage ?? 1}`;

function screenObjectsForStage(stageIndex = state.currentStageIndex) {
  const overrides = STAGES[stageIndex].screenObjectOverrides ?? {};
  return SCREEN_OBJECTS.map((object) => (
    overrides[object.id] ? { ...object, ...overrides[object.id] } : object
  ));
}

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

  STAGES.forEach((stage, stageIndex) => {
    if (ids.has(stage.id)) throw new Error(`ステージID ${stage.id} が重複しています。`);
    ids.add(stage.id);

    const positionKey = cellKey(stage.position.x, stage.position.y);
    if (positions.has(positionKey)) throw new Error(`ワールド座標 ${positionKey} が重複しています。`);
    positions.add(positionKey);

    Object.keys(stage.screenObjectOverrides ?? {}).forEach((objectId) => {
      if (!SCREEN_OBJECTS.some((object) => object.id === objectId)) {
        throw new Error(`${stage.id}が存在しない画面オブジェクト${objectId}を変更しています。`);
      }
    });
    screenObjectsForStage(stageIndex).forEach((object) => {
      assertArea({ ...object, id: `${stage.id}:${object.id}` });
    });

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
  if (object.direction) entity.dataset.direction = object.direction;
  if (object.kind === "warp") {
    const sprite = document.createElement("img");
    sprite.className = "warp-point__sprite";
    sprite.src = "asset/warp-point.png";
    sprite.alt = "";
    sprite.draggable = false;
    entity.append(sprite);
  } else if (object.kind === "slime") {
    const sprite = document.createElement("img");
    sprite.className = "slime-sprite";
    sprite.src = SLIME_SPRITE_PATH;
    sprite.alt = "";
    sprite.draggable = false;
    entity.append(sprite);
  } else if (object.kind === "direction") {
    const sprite = document.createElement("img");
    sprite.className = "field-direction__sprite";
    sprite.src = "asset/direction-button.webp";
    sprite.alt = "";
    sprite.draggable = false;
    entity.append(sprite);
  } else if (object.kind === "boss") {
    const sprite = document.createElement("span");
    sprite.className = "boss-sprite";
    sprite.textContent = "👹";
    sprite.setAttribute("aria-hidden", "true");
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
  const screenObjects = screenObjectsForStage();
  const playZone = screenObjects.find((object) => object.id === "play-zone");
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
  screenObjects
    .filter((object) => object.kind === "button")
    .forEach((object) => fragment.append(createScreenObject(object)));
  stage.objects
    .filter((object) => !state.defeatedEnemies.has(object.id))
    .forEach((object) => fragment.append(createEntity(object)));
  fragment.append(createPlayer());

  stageElement.replaceChildren(fragment);
  stageElement.dataset.stageId = stage.id;
  stageElement.dataset.worldX = String(stage.position.x);
  stageElement.dataset.worldY = String(stage.position.y);

  const number = stageElement.querySelector('[data-object-id="stage-number"] .stage-number__value');
  number.textContent = stageLabel(stage);
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
  clearUndoRepeats();
  clearWarpExit();
  state.manualInputSources.clear();
  state.pressedControlSources.clear();
  state.activeDirectionPointerSources.clear();
  state.warpArrivalKey = null;
  state.currentStageIndex = index;
  state.player = { ...stage.start };
  state.lastRenderedPlayer = null;
  state.history = [];
  state.message = message || `ステージ${stageLabel(stage)}：矢印で移動します`;
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
  const button = screenButtonAt(x, y);
  return button ? directionFromAction(button.action) : null;
}

function refreshControlPressedStates() {
  stageElement.querySelectorAll(".stage-object--button[data-action]").forEach((element) => {
    const object = screenObjectsForStage().find(
      (candidate) => candidate.id === element.dataset.objectId,
    );
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
  const fieldDirection = currentStage().objects.find((object) => (
    object.kind === "direction" && containsCell(object, x, y)
  ));
  if (fieldDirection) return fieldDirection;

  return screenObjectsForStage().find((object) => (
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

function enemyAt(stageIndex, x, y) {
  return STAGES[stageIndex].objects.find((object) => (
    (object.kind === "slime" || object.kind === "boss")
    && containsCell(object, x, y)
    && !state.defeatedEnemies.has(object.id)
  ));
}

function isWalkable(x, y, stageIndex = state.currentStageIndex) {
  if (x < 0 || y < 0 || x >= BOARD.columns || y >= BOARD.rows) return false;
  if (STAGES[stageIndex].holes.some((hole) => hole.x === x && hole.y === y)) return false;
  if (enemyAt(stageIndex, x, y)) return false;
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

function clearWarpExit() {
  if (state.warpExitTimer !== null) window.clearTimeout(state.warpExitTimer);
  state.warpExitTimer = null;
  state.pendingWarpExit = null;
}

function scheduleWarpExit(pendingWarpExit) {
  state.warpExitTimer = window.setTimeout(() => {
    if (state.pendingWarpExit !== pendingWarpExit) return;
    const destinationWarp = warpAt(
      pendingWarpExit.destinationStageIndex,
      state.player.x,
      state.player.y,
    );
    const isStillAtDestination = state.currentStageIndex === pendingWarpExit.destinationStageIndex
      && destinationWarp?.id === pendingWarpExit.destinationWarpId;

    if (!isStillAtDestination) {
      clearWarpExit();
      return;
    }

    state.currentStageIndex = pendingWarpExit.exit.stageIndex;
    state.player.x = pendingWarpExit.exit.x;
    state.player.y = pendingWarpExit.exit.y;
    state.player.facing = pendingWarpExit.directionName;
    state.warpArrivalKey = null;
    pendingWarpExit.phase = "moving";
    playFootstepSound();
    state.warpExitTimer = window.setTimeout(() => {
      if (state.pendingWarpExit === pendingWarpExit) state.pendingWarpExit = null;
      state.warpExitTimer = null;
    }, PLAYER_MOVE_DURATION);
    render();
  }, WARP_EXIT_DELAY);
}

function beginWarpSequence(sourceStageIndex, sourceWarp, destination, exit, directionName) {
  clearWarpExit();
  const pendingWarpExit = {
    sourceStageIndex,
    sourceWarpId: sourceWarp.id,
    destinationStageIndex: destination.stageIndex,
    destinationWarpId: destination.warp.id,
    exit,
    directionName,
    phase: "activating",
  };
  state.pendingWarpExit = pendingWarpExit;

  state.warpExitTimer = window.setTimeout(() => {
    if (state.pendingWarpExit !== pendingWarpExit) return;
    const sourceWarpAtPlayer = warpAt(
      pendingWarpExit.sourceStageIndex,
      state.player.x,
      state.player.y,
    );
    const isStillAtSource = state.currentStageIndex === pendingWarpExit.sourceStageIndex
      && sourceWarpAtPlayer?.id === pendingWarpExit.sourceWarpId;

    if (!isStillAtSource) {
      clearWarpExit();
      return;
    }

    state.currentStageIndex = pendingWarpExit.destinationStageIndex;
    state.player.x = destination.warp.x;
    state.player.y = destination.warp.y;
    state.player.facing = pendingWarpExit.directionName;
    state.warpArrivalKey = warpKey(destination.stageIndex, destination.warp);
    pendingWarpExit.phase = "waiting";
    playWarpSound();
    render();
    scheduleWarpExit(pendingWarpExit);
  }, WARP_ACTIVATION_DELAY);
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

  const exit = walkableStepFrom(
    destination.stageIndex,
    destination.warp.x,
    destination.warp.y,
    directionName,
  );
  if (!exit || warpAt(exit.stageIndex, exit.x, exit.y)) {
    state.warpArrivalKey = sourceKey;
    return { sourceWarp, destination: null, blockedDestination: destination };
  }

  state.warpArrivalKey = sourceKey;
  beginWarpSequence(sourceStageIndex, sourceWarp, destination, exit, directionName);
  return { sourceWarp, destination, exit };
}

function walkableStepFrom(stageIndex, x, y, directionName) {
  const direction = DIRECTIONS[directionName];
  let nextStageIndex = stageIndex;
  let nextX = x + direction.x;
  let nextY = y + direction.y;

  if (nextX < 0 || nextX >= BOARD.columns || nextY < 0 || nextY >= BOARD.rows) {
    const stagePosition = STAGES[stageIndex].position;
    const worldStageX = stagePosition.x + (nextX < 0 ? -1 : nextX >= BOARD.columns ? 1 : 0);
    const worldStageY = stagePosition.y + (nextY < 0 ? -1 : nextY >= BOARD.rows ? 1 : 0);
    nextStageIndex = stageIndexAtWorldPosition(worldStageX, worldStageY);
    if (nextStageIndex < 0) return null;

    if (nextX < 0) nextX = BOARD.columns - 1;
    else if (nextX >= BOARD.columns) nextX = 0;
    if (nextY < 0) nextY = BOARD.rows - 1;
    else if (nextY >= BOARD.rows) nextY = 0;
  }

  if (!isWalkable(nextX, nextY, nextStageIndex)) return null;
  return { stageIndex: nextStageIndex, x: nextX, y: nextY };
}

function moveOneCell(directionName) {
  const next = walkableStepFrom(
    state.currentStageIndex,
    state.player.x,
    state.player.y,
    directionName,
  );
  if (!next) return false;

  state.currentStageIndex = next.stageIndex;
  state.player.x = next.x;
  state.player.y = next.y;
  state.player.facing = directionName;
  playFootstepSound();
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
  if (state.pendingWarpExit) {
    clearButtonMotion();
    return;
  }
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
    state.message = `ワープ起動中：ステージ${stageLabel(STAGES[warpResult.destination.stageIndex])}へ移動します`;
  } else if (state.currentStageIndex !== previousStageIndex) {
    state.message = `地続きのステージ${stageLabel(currentStage())}へ移動しました`;
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
  if (state.pendingWarpExit) return;
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
  const direction = DIRECTIONS[directionName];
  const blockingEnemy = enemyAt(
    state.currentStageIndex,
    state.player.x + direction.x,
    state.player.y + direction.y,
  );
  state.player.facing = directionName;

  if (moveOneCell(directionName)) {
    remember(previousPlayer, previousStageIndex);
    const warpResult = resolveWarpAfterMove(directionName);
    if (warpResult?.destination) {
      state.message = `ワープ起動中：ステージ${stageLabel(STAGES[warpResult.destination.stageIndex])}へ移動します`;
    } else if (warpResult && !warpResult.destination) {
      state.message = `${DIRECTIONS[directionName].label}方向にワープポイントがありません`;
    } else if (state.currentStageIndex !== previousStageIndex) {
      state.message = `地続きのステージ${stageLabel(currentStage())}へ移動しました`;
    } else {
      state.message = `${DIRECTIONS[directionName].label}へ移動しました`;
    }
  } else {
    state.message = blockingEnemy
      ? `${blockingEnemy.label}が道をふさいでいます。Aで攻撃しましょう`
      : "その先は盤面外または穴です";
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

function clearUndoRepeat(sourceId) {
  const timer = state.undoRepeatTimers.get(sourceId);
  if (timer !== undefined) window.clearTimeout(timer);
  state.undoRepeatTimers.delete(sourceId);
}

function clearUndoRepeats() {
  [...state.undoRepeatTimers.keys()].forEach(clearUndoRepeat);
  state.activeUndoSources.clear();
}

function scheduleUndoRepeat(sourceId, delay) {
  clearUndoRepeat(sourceId);
  const timer = window.setTimeout(() => {
    state.undoRepeatTimers.delete(sourceId);
    if (!state.activeUndoSources.has(sourceId)) return;

    undo();
    scheduleUndoRepeat(sourceId, UNDO_REPEAT_INTERVAL);
  }, delay);
  state.undoRepeatTimers.set(sourceId, timer);
}

function pressUndo(sourceId) {
  if (state.activeUndoSources.has(sourceId)) return;
  state.activeUndoSources.add(sourceId);
  undo();
  scheduleUndoRepeat(sourceId, UNDO_REPEAT_DELAY);
}

function releaseUndo(sourceId) {
  state.activeUndoSources.delete(sourceId);
  clearUndoRepeat(sourceId);
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
  clearWarpExit();
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
    if (object.kind !== "slime" && object.kind !== "boss") return false;
    if (state.defeatedEnemies.has(object.id)) return false;
    const objectKey = cellKey(object.x, object.y);
    return objectKey === currentKey || objectKey === frontKey;
  });
}

function interact(missMessage = "剣を振りました") {
  const target = findInteractionTarget();

  if (!target) {
    state.message = missMessage;
    render();
    return;
  }

  if (target.kind === "slime") {
    state.defeatedEnemies.add(target.id);
    state.message = "スライムを倒しました";
    render();
    return;
  }

  if (target.kind === "boss") {
    state.defeatedEnemies.add(target.id);
    state.message = "魔王を斬りました";
    render();
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

  // 剣を振った方向の現在地・1マス前にいる敵へ攻撃する。
  interact();
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
      state.message = `現在地：ステージ${stageLabel(currentStage())}`;
      render();
    },
  };

  actions[action]?.();
}

function debugLoadAdjacentStage(directionName) {
  const direction = DIRECTIONS[directionName];
  const position = currentStage().position;
  const targetStageIndex = stageIndexAtWorldPosition(
    position.x + direction.x,
    position.y + direction.y,
  );

  if (targetStageIndex < 0) {
    state.message = `デバッグ：${direction.label}側にステージはありません`;
    render();
    return false;
  }

  const targetStage = STAGES[targetStageIndex];
  loadStage(targetStageIndex, `デバッグ移動：Stage ${stageLabel(targetStage)}`);
  return true;
}

stageElement.addEventListener("pointerdown", (event) => {
  unlockSoundEffects();
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const sourceId = `pointer:${event.pointerId}`;
  const action = button.dataset.action;
  pressControl(sourceId, action);

  if (action === "undo") {
    event.preventDefault();
    try {
      stageElement.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events do not own an active pointer to capture.
    }
    pressUndo(sourceId);
    return;
  }

  const directionName = directionFromAction(action);
  if (!directionName) return;

  event.preventDefault();
  state.activeDirectionPointerSources.add(sourceId);
  try {
    stageElement.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic pointer events do not own an active pointer to capture.
  }
  pressDirection(sourceId, directionName);
});

stageElement.addEventListener("pointermove", (event) => {
  const sourceId = `pointer:${event.pointerId}`;
  if (!state.activeDirectionPointerSources.has(sourceId)) return;

  event.preventDefault();
  const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
  const button = pointedElement?.closest?.(".stage-object--button[data-action]");
  const nextDirection = directionFromAction(button?.dataset.action);
  const currentDirection = state.manualInputSources.get(sourceId) ?? null;

  if (currentDirection === nextDirection) return;

  releaseDirection(sourceId);
  releaseControl(sourceId);

  if (!nextDirection) return;
  pressControl(sourceId, button.dataset.action);
  pressDirection(sourceId, nextDirection);
});

function releasePointerInput(event) {
  const sourceId = `pointer:${event.pointerId}`;
  state.activeDirectionPointerSources.delete(sourceId);
  releaseDirection(sourceId);
  releaseUndo(sourceId);
  releaseControl(sourceId);
}

window.addEventListener("pointerup", releasePointerInput);
window.addEventListener("pointercancel", releasePointerInput);
stageElement.addEventListener("lostpointercapture", releasePointerInput);

["contextmenu", "selectstart", "dragstart"].forEach((eventName) => {
  stageElement.addEventListener(eventName, (event) => event.preventDefault());
});

stageElement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const directionName = directionFromAction(button.dataset.action);
  if (directionName) {
    // マウス・タッチはpointerdownで処理済み。キーボード操作とelement.click()だけ補います。
    if (event.detail === 0) tapDirection(directionName);
    return;
  }
  if (button.dataset.action === "undo" && event.detail !== 0) return;
  runAction(button.dataset.action);
});

window.addEventListener("keydown", (event) => {
  unlockSoundEffects();
  const keyDirections = {
    ArrowUp: "up",
    ArrowRight: "right",
    ArrowDown: "down",
    ArrowLeft: "left",
  };
  const directionName = keyDirections[event.key];
  const sourceId = `key:${event.code || event.key}`;
  if (directionName && event.shiftKey) {
    event.preventDefault();
    if (!event.repeat) debugLoadAdjacentStage(directionName);
    return;
  }

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
  if (action === "undo") {
    pressUndo(sourceId);
    return;
  }
  runAction(action);
});

window.addEventListener("keyup", (event) => {
  const sourceId = `key:${event.code || event.key}`;
  if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
    releaseDirection(sourceId);
  }
  releaseUndo(sourceId);
  releaseControl(sourceId);
});

window.addEventListener("blur", () => {
  const sourceIds = [...state.manualInputSources.keys()];
  sourceIds.forEach(releaseDirection);
  clearUndoRepeats();
  state.activeDirectionPointerSources.clear();
  state.pressedControlSources.clear();
  refreshControlPressedStates();
});

validateStageData();
startEnvironmentAnimation();
loadStage(0, "右側のワープポイントを目指してください");
