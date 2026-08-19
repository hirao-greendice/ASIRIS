"use strict";

// 盤面上の座標はすべて0始まりです。
const BOARD = Object.freeze({ columns: 11, rows: 18 });

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

// 灰色の字幕エリアは盤面に含めません。ここから下のピンク部分だけが11×18のステージです。
const SCREEN_OBJECTS = Object.freeze([
  {
    id: "play-zone",
    kind: "zone",
    x: 1,
    y: 1,
    width: 9,
    height: 9,
    label: "プレイエリア",
  },
  {
    id: "move-up",
    kind: "button",
    action: "move-up",
    x: 3,
    y: 11,
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
    y: 13,
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
    y: 13,
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
    y: 15,
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
    y: 11,
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
    y: 15,
    width: 2,
    height: 2,
    symbol: "U",
    label: "一手戻す",
  },
]);

const START_MARKERS = Object.freeze({ "^": "up", ">": "right", v: "down", "<": "left" });
const DIRECTION_MARKERS = Object.freeze({ U: "up", R: "right", D: "down", L: "left" });
let GAME_CONTENT = null;
let STAGES = Object.freeze([]);
let SPEAKERS = Object.freeze({});
let DIALOGUES = Object.freeze({});
let DIALOGUE_DEFAULTS = Object.freeze({ characterIntervalMs: 38, startDelayMs: 280 });

function parseStageMap(rawStage) {
  if (!Array.isArray(rawStage.map) || rawStage.map.length !== BOARD.rows) {
    throw new Error(`${rawStage.id} のmapは${BOARD.rows}行で指定してください。`);
  }

  const metadata = rawStage.objects ?? {};
  const queues = {
    warp: [...(metadata.warps ?? [])],
    slime: [...(metadata.slimes ?? [])],
    boss: [...(metadata.bosses ?? [])],
  };
  const queueIndexes = { warp: 0, slime: 0, boss: 0 };
  const directionIds = metadata.directionIds ?? [];
  let directionIndex = 0;
  let start = null;
  const floor = [];
  const holes = [];
  const objects = [];

  const takeMetadata = (kind, x, y) => {
    const entry = queues[kind][queueIndexes[kind]];
    if (!entry) throw new Error(`${rawStage.id} の (${x}, ${y}) にある${kind}の設定がobjectsにありません。`);
    queueIndexes[kind] += 1;
    return entry;
  };

  rawStage.map.forEach((row, y) => {
    const symbols = [...row];
    if (symbols.length !== BOARD.columns) {
      throw new Error(`${rawStage.id} のmap ${y + 1}行目は${BOARD.columns}文字で指定してください。`);
    }

    symbols.forEach((symbol, x) => {
      if (symbol === ".") return;
      if (symbol === "#") {
        floor.push({ x, y });
        return;
      }
      if (symbol === "O") {
        holes.push({ x, y });
        return;
      }
      if (START_MARKERS[symbol]) {
        if (start) throw new Error(`${rawStage.id} の開始位置が複数あります。`);
        start = { x, y, facing: START_MARKERS[symbol] };
        floor.push({ x, y });
        return;
      }

      const direction = DIRECTION_MARKERS[symbol];
      if (direction) {
        const id = directionIds[directionIndex] ?? `${rawStage.id}-direction-${directionIndex + 1}`;
        directionIndex += 1;
        floor.push({ x, y });
        objects.push({
          id,
          kind: "direction",
          action: `move-${direction}`,
          direction,
          x,
          y,
          label: `${DIRECTIONS[direction].label}へ進む矢印`,
        });
        return;
      }

      const kindByMarker = { W: "warp", S: "slime", B: "boss", b: "boss" };
      const kind = kindByMarker[symbol];
      if (!kind) throw new Error(`${rawStage.id} のmapに未定義の記号「${symbol}」があります。`);
      const entry = takeMetadata(kind, x, y);
      if (symbol !== "b") floor.push({ x, y });
      objects.push({ ...entry, kind, x, y });
    });
  });

  if (!start) throw new Error(`${rawStage.id} のmapに開始位置 (^ > v <) がありません。`);
  Object.entries(queues).forEach(([kind, entries]) => {
    if (queueIndexes[kind] !== entries.length) {
      throw new Error(`${rawStage.id} の${kind}設定数とmap上の記号数が一致しません。`);
    }
  });
  if (directionIndex !== directionIds.length) {
    throw new Error(`${rawStage.id} のdirectionIds数とmap上の矢印数が一致しません。`);
  }

  return Object.freeze({
    ...rawStage,
    map: Object.freeze([...rawStage.map]),
    start: Object.freeze(start),
    floor: Object.freeze(floor),
    holes: Object.freeze(holes),
    objects: Object.freeze(objects),
    warpRoutes: Object.freeze(rawStage.warpRoutes ?? {}),
  });
}

function configureGameContent(content) {
  if (content.version !== 2) throw new Error(`未対応のゲームデータversionです: ${content.version}`);
  GAME_CONTENT = content;
  STAGES = Object.freeze(content.stages.map(parseStageMap));
  SPEAKERS = Object.freeze(content.speakers ?? {});
  DIALOGUES = Object.freeze(content.dialogues ?? {});
  DIALOGUE_DEFAULTS = Object.freeze({ ...DIALOGUE_DEFAULTS, ...(content.dialogueDefaults ?? {}) });
}

const stageElement = document.querySelector("#stage");
const topHudElement = document.querySelector(".top-hud");
const hudStageNumberElement = document.querySelector("#hud-stage-number");
const dialoguePortraitElement = document.querySelector("#dialogue-portrait");
const dialogueSpeakerElement = document.querySelector("#dialogue-speaker");
const dialogueTextElement = document.querySelector("#dialogue-text");
let environmentFlipTimer = null;

function startEnvironmentAnimation() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (environmentFlipTimer !== null) window.clearInterval(environmentFlipTimer);

  environmentFlipTimer = window.setInterval(() => {
    stageElement.classList.toggle("is-environment-flipped");
  }, ENVIRONMENT_FLIP_INTERVAL);
}

const state = {
  isReady: false,
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
  dialogueSequenceToken: 0,
  dialogueTimers: new Set(),
  dialogueTypingTimer: null,
};

const cellKey = (x, y) => `${x},${y}`;
const currentStage = () => STAGES[state.currentStageIndex];
const stageLabel = (stage) => stage.substage ? `${stage.number}-${stage.substage}` : String(stage.number);

function clearDialogueTimers() {
  state.dialogueSequenceToken += 1;
  state.dialogueTimers.forEach((timer) => window.clearTimeout(timer));
  state.dialogueTimers.clear();
  if (state.dialogueTypingTimer !== null) window.clearTimeout(state.dialogueTypingTimer);
  state.dialogueTypingTimer = null;
}

function showDialogue(entry, options = {}) {
  if (!entry) return;
  if (state.dialogueTypingTimer !== null) window.clearTimeout(state.dialogueTypingTimer);
  state.dialogueTypingTimer = null;

  const speaker = SPEAKERS[entry.speaker] ?? SPEAKERS.system ?? {};
  dialogueSpeakerElement.textContent = entry.name ?? speaker.name ?? "";
  dialogueSpeakerElement.style.color = entry.nameColor ?? speaker.nameColor ?? "#fff200";
  dialoguePortraitElement.src = entry.portrait ?? speaker.portrait ?? "asset/hero-right-idle.png";

  const characters = [...String(entry.text ?? "")];
  const interval = options.instant
    ? 0
    : Math.max(0, Number(entry.characterIntervalMs ?? DIALOGUE_DEFAULTS.characterIntervalMs));
  dialogueTextElement.textContent = "";
  if (interval === 0) {
    dialogueTextElement.textContent = characters.join("");
    return;
  }

  const token = state.dialogueSequenceToken;
  let cursor = 0;
  const typeNextCharacter = () => {
    if (token !== state.dialogueSequenceToken) return;
    cursor += 1;
    dialogueTextElement.textContent = characters.slice(0, cursor).join("");
    if (cursor >= characters.length) {
      state.dialogueTypingTimer = null;
      return;
    }
    state.dialogueTypingTimer = window.setTimeout(typeNextCharacter, interval);
  };
  typeNextCharacter();
}

function triggerDialogues(eventName, context = {}) {
  const entries = DIALOGUES[currentStage().id] ?? [];
  const token = state.dialogueSequenceToken;
  entries
    .filter((entry) => {
      if (entry.trigger?.event !== eventName) return false;
      if (entry.trigger.targetId && entry.trigger.targetId !== context.targetId) return false;
      return true;
    })
    .forEach((entry) => {
      const delay = Math.max(0, Number(entry.delayMs ?? DIALOGUE_DEFAULTS.startDelayMs));
      const timer = window.setTimeout(() => {
        state.dialogueTimers.delete(timer);
        if (token === state.dialogueSequenceToken) showDialogue(entry);
      }, delay);
      state.dialogueTimers.add(timer);
    });
}

function beginStageDialogue() {
  clearDialogueTimers();
  dialogueSpeakerElement.textContent = "";
  dialogueTextElement.textContent = "";
  triggerDialogues("stage-start");
}

function showSystemDialogue(text) {
  clearDialogueTimers();
  showDialogue({ speaker: "system", text, characterIntervalMs: 22 });
}

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
    throw new Error(`${id} の座標が11×18の盤面外です。`);
  }
}

function validateStageData() {
  const ids = new Set();
  const screenObjectIds = new Set();

  SCREEN_OBJECTS.forEach((object) => {
    assertArea(object);
    if (screenObjectIds.has(object.id)) throw new Error(`画面オブジェクトID ${object.id} が重複しています。`);
    screenObjectIds.add(object.id);
  });

  STAGES.forEach((stage, stageIndex) => {
    if (ids.has(stage.id)) throw new Error(`ステージID ${stage.id} が重複しています。`);
    ids.add(stage.id);

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

  STAGES.forEach((stage) => {
    Object.entries(stage.warpRoutes).forEach(([sourceWarpId, routes]) => {
      const sourceWarp = stage.objects.find((object) => object.kind === "warp" && object.id === sourceWarpId);
      if (!sourceWarp) throw new Error(`${stage.id} のwarpRoutes元 ${sourceWarpId} がmapにありません。`);
      Object.entries(routes).forEach(([directionName, destination]) => {
        if (!DIRECTIONS[directionName]) throw new Error(`${stage.id}:${sourceWarpId} の方向 ${directionName} は不正です。`);
        const targetStage = STAGES.find((candidate) => candidate.id === destination.stageId);
        const targetWarp = targetStage?.objects.find((object) => (
          object.kind === "warp" && object.id === destination.warpId
        ));
        if (!targetWarp) {
          throw new Error(`${stage.id}:${sourceWarpId} の移動先 ${destination.stageId}:${destination.warpId} がありません。`);
        }
      });
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
  hudStageNumberElement.textContent = stageLabel(stage);
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
  beginStageDialogue();
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

function warpKey(stageIndex, warp) {
  return `${STAGES[stageIndex].id}:${warp.id}`;
}

function warpAt(stageIndex, x, y) {
  return STAGES[stageIndex].objects.find((object) => (
    object.kind === "warp" && object.x === x && object.y === y
  ));
}

function nearestWarpInDirection(sourceStageIndex, sourceWarp, directionName) {
  const route = STAGES[sourceStageIndex].warpRoutes[sourceWarp.id]?.[directionName];
  if (!route) return null;
  const stageIndex = STAGES.findIndex((stage) => stage.id === route.stageId);
  const warp = STAGES[stageIndex]?.objects.find((object) => (
    object.kind === "warp" && object.id === route.warpId
  ));
  return warp ? { stageIndex, warp } : null;
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
    beginStageDialogue();
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
  const nextX = x + direction.x;
  const nextY = y + direction.y;
  if (!isWalkable(nextX, nextY, stageIndex)) return null;
  return { stageIndex, x: nextX, y: nextY };
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
  if (!moveOneCell(tileDirection)) {
    state.message = `${DIRECTIONS[tileDirection].label}ボタンの先へ進めません`;
    clearButtonMotion();
    render();
    return;
  }

  const warpResult = resolveWarpAfterMove(tileDirection);
  if (warpResult?.destination) {
    state.message = `ワープ起動中：ステージ${stageLabel(STAGES[warpResult.destination.stageIndex])}へ移動します`;
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
    clearDialogueTimers();
    triggerDialogues("enemy-defeated", { targetId: target.id });
    return;
  }

  if (target.kind === "boss") {
    state.defeatedEnemies.add(target.id);
    state.message = "魔王を斬りました";
    render();
    clearDialogueTimers();
    triggerDialogues("enemy-defeated", { targetId: target.id });
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
      showSystemDialogue(currentStage().hint);
    },
    settings: () => {
      state.message = "設定画面は次の実装段階で追加できます";
      showSystemDialogue(state.message);
    },
    "stage-info": () => {
      state.message = `現在地：ステージ${stageLabel(currentStage())}`;
      showSystemDialogue(state.message);
    },
  };

  actions[action]?.();
}

function debugLoadAdjacentStage(directionName) {
  state.message = `デバッグ：ステージは独立しているため${DIRECTIONS[directionName].label}側へ直接移動できません`;
  showSystemDialogue(state.message);
  return false;
}

stageElement.addEventListener("pointerdown", (event) => {
  if (!state.isReady) return;
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
  if (!state.isReady) return;
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
  if (!state.isReady) return;
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
  if (!state.isReady) return;
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
  if (!state.isReady) return;
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

topHudElement.addEventListener("click", (event) => {
  if (!state.isReady) return;
  const button = event.target.closest(".hud-button[data-action]");
  if (!button) return;
  unlockSoundEffects();
  runAction(button.dataset.action);
});

["contextmenu", "selectstart", "dragstart"].forEach((eventName) => {
  topHudElement.addEventListener(eventName, (event) => event.preventDefault());
});

function showLoadError(error) {
  console.error(error);
  dialogueSpeakerElement.textContent = "読み込みエラー";
  dialogueSpeakerElement.style.color = "#ff8f8f";
  dialogueTextElement.textContent = error.message;
}

async function startGame() {
  const response = await fetch("data/game-content.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`ゲームデータを読み込めませんでした (${response.status})`);
  configureGameContent(await response.json());
  validateStageData();
  const initialStageIndex = STAGES.findIndex((stage) => stage.id === GAME_CONTENT.initialStageId);
  if (initialStageIndex < 0) throw new Error(`初期ステージ ${GAME_CONTENT.initialStageId} がありません。`);
  state.isReady = true;
  startEnvironmentAnimation();
  loadStage(initialStageIndex, "右側のワープポイントを目指してください");
}

startGame().catch(showLoadError);
