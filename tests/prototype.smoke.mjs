import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, "..", "index.html")).href;
const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browserPath = browserCandidates.find(existsSync);
const heroAssetNames = ["up", "right", "down", "left"]
  .flatMap((direction) => ["idle", "attack"].map((pose) => `hero-${direction}-${pose}.png`));

heroAssetNames.forEach((fileName) => {
  if (!existsSync(resolve(here, "..", "asset", fileName))) {
    throw new Error(`勇者素材 ${fileName} が見つかりません。`);
  }
});

if (!existsSync(resolve(here, "..", "asset", "warp-point.png"))) {
  throw new Error("ワープポイント素材が見つかりません。");
}

["footstep.mp3", "warp.mp3"].forEach((fileName) => {
  if (!existsSync(resolve(here, "..", "asset", fileName))) {
    throw new Error(`効果音素材 ${fileName} が見つかりません。`);
  }
});

if (!browserPath) throw new Error("ChromeまたはEdgeが見つかりません。");

const port = await new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.on("error", rejectPort);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolvePort(address.port));
  });
});

const profileDirectory = mkdtempSync(join(tmpdir(), "knowledge-unlock-smoke-"));
const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDirectory}`,
  pageUrl,
], { stdio: "ignore" });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((entry) => entry.type === "page" && entry.url.startsWith("file:"));
      if (page) return page;
    } catch {
      // ブラウザのデバッグポートが開くまで待つ。
    }
    await delay(100);
  }
  throw new Error("テスト用ページを開けませんでした。");
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

let nextMessageId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextMessageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? "ブラウザ内で例外が発生しました。");
  }
  return response.result.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });

  const initial = await evaluate(`(() => {
    const stage = document.querySelector("#stage");
    const bounds = stage.getBoundingClientRect();
    const playZone = document.querySelector('[data-object-id="play-zone"]');
    const firstSea = document.querySelector('[data-object-id="sea-1-2"]');
    const nextSea = document.querySelector('[data-object-id="sea-2-2"]');
    const panelTop = document.querySelector('[data-object-id="panel-0-0"]');
    const panelBelow = document.querySelector('[data-object-id="panel-0-1"]');
    const exposedPanel = document.querySelector('[data-object-id="panel-1-1"]');
    const land = document.querySelector('[data-object-kind="floor"]:not(.has-tile-below)');
    const stageNumber = document.querySelector('[data-object-id="stage-number"]');
    const settings = document.querySelector('[data-object-id="settings"]');
    const hint = document.querySelector('[data-object-id="hint"]');
    const direction = document.querySelector('[data-object-id="move-right"]');
    const action = document.querySelector('[data-object-id="interact"]');
    const undo = document.querySelector('[data-object-id="undo"]');
    const warp = document.querySelector('[data-object-kind="warp"]');
    const cellHeight = bounds.height / 19;
    const cellWidth = bounds.width / 11;
    return {
      cells: document.querySelectorAll(".board-cell").length,
      panels: document.querySelectorAll('[data-object-kind="panel"]').length,
      seas: document.querySelectorAll('[data-object-kind="sea"]').length,
      warps: document.querySelectorAll('[data-object-kind="warp"]').length,
      stageId: stage.dataset.stageId,
      playZoneSize: [playZone.dataset.width, playZone.dataset.height],
      playZonePosition: [playZone.dataset.x, playZone.dataset.y],
      stageNumberSize: [stageNumber.dataset.width, stageNumber.dataset.height],
      settingsSize: [settings.dataset.width, settings.dataset.height],
      hintSize: [hint.dataset.width, hint.dataset.height],
      topUiPositions: {
        settings: [settings.dataset.x, settings.dataset.y],
        stage: [stageNumber.dataset.x, stageNumber.dataset.y],
        hint: [hint.dataset.x, hint.dataset.y],
      },
      bottomUiPositions: {
        up: [document.querySelector('[data-object-id="move-up"]').dataset.x, document.querySelector('[data-object-id="move-up"]').dataset.y],
        left: [document.querySelector('[data-object-id="move-left"]').dataset.x, document.querySelector('[data-object-id="move-left"]').dataset.y],
        right: [direction.dataset.x, direction.dataset.y],
        down: [document.querySelector('[data-object-id="move-down"]').dataset.x, document.querySelector('[data-object-id="move-down"]').dataset.y],
        action: [action.dataset.x, action.dataset.y],
        undo: [undo.dataset.x, undo.dataset.y],
      },
      actionRightColumns: 11 - (Number(action.dataset.x) + Number(action.dataset.width)),
      undoRightColumns: 11 - (Number(undo.dataset.x) + Number(undo.dataset.width)),
      playerPose: document.querySelector("#player").dataset.pose,
      playerSprite: document.querySelector("#player .player-sprite").src,
      hasStatusText: Boolean(document.querySelector("#stage-status")),
      ratio: bounds.width / bounds.height,
      landOverhangs: land.getBoundingClientRect().height > cellHeight,
      panelOverhangs: exposedPanel.getBoundingClientRect().height > cellHeight,
      landFitsGridWidth: Math.abs(land.getBoundingClientRect().width - cellWidth) < 0.02,
      panelFitsGridWidth: Math.abs(exposedPanel.getBoundingClientRect().width - cellWidth) < 0.02,
      lowerPanelIsAbove: Number(getComputedStyle(panelBelow).zIndex) > Number(getComputedStyle(panelTop).zIndex),
      seaColor: getComputedStyle(firstSea).backgroundColor,
      seaImage: getComputedStyle(firstSea).backgroundImage,
      seaImageSize: getComputedStyle(firstSea).backgroundSize,
      seaFitsGrid: Math.abs(firstSea.getBoundingClientRect().width - cellWidth) < 0.02
        && Math.abs(firstSea.getBoundingClientRect().height - cellHeight) < 0.02,
      seaTilesTouch: Math.abs(
        firstSea.getBoundingClientRect().right - nextSea.getBoundingClientRect().left
      ) < 0.02,
      warpLogicalSize: [warp.dataset.width, warp.dataset.height],
      warpSprite: warp.querySelector(".warp-point__sprite").src,
      footstepSoundSource: footstepAudio.src,
      warpSoundSource: warpAudio.src,
      footstepSnippetDuration: FOOTSTEP_SNIPPET_DURATION,
      environmentTimerStarted: environmentFlipTimer !== null,
      environmentFlipInterval: ENVIRONMENT_FLIP_INTERVAL,
      seaFlipIsInstant: getComputedStyle(firstSea).transitionDuration === "0s",
      warpFlipIsInstant: getComputedStyle(warp.querySelector(".warp-point__sprite")).transitionDuration === "0s",
      topUiVisualsInset: parseFloat(getComputedStyle(settings, "::before").width) < settings.getBoundingClientRect().width
        && parseFloat(getComputedStyle(settings, "::before").height) < settings.getBoundingClientRect().height
        && parseFloat(getComputedStyle(stageNumber, "::before").width) < stageNumber.getBoundingClientRect().width
        && parseFloat(getComputedStyle(stageNumber, "::before").height) < stageNumber.getBoundingClientRect().height
        && parseFloat(getComputedStyle(hint, "::before").width) < hint.getBoundingClientRect().width
        && parseFloat(getComputedStyle(hint, "::before").height) < hint.getBoundingClientRect().height,
      stageNumberIsHorizontal: getComputedStyle(stageNumber.querySelector(".stage-number__copy"))
        .gridTemplateColumns.split(" ").length === 2,
      panelColor: getComputedStyle(panelBelow).backgroundColor,
      landColor: getComputedStyle(document.querySelector('[data-object-kind="floor"].has-tile-below')).backgroundColor,
      panelSide: getComputedStyle(exposedPanel).backgroundImage,
      landSide: getComputedStyle(land).backgroundImage,
      uiAssets: {
        settings: getComputedStyle(settings, "::before").backgroundImage,
        stage: getComputedStyle(stageNumber, "::before").backgroundImage,
        hint: getComputedStyle(hint, "::before").backgroundImage,
        direction: getComputedStyle(direction).backgroundImage,
        action: getComputedStyle(action).backgroundImage,
        undo: getComputedStyle(undo).backgroundImage,
      },
      touchGesturesDisabled: getComputedStyle(stage).touchAction === "none",
      selectionDisabled: getComputedStyle(stage).userSelect === "none"
        && getComputedStyle(direction).userSelect === "none",
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight,
    };
  })()`);

  assert(initial.cells === 0, "グリッド線用の補助セルが残っています。");
  assert(initial.panels === 11 * 19 - 9 * 9, `パネル数が${initial.panels}です。`);
  assert(initial.seas === 9 * 9, `Seaタイル数が${initial.seas}です。`);
  assert(initial.warps === 1, `表示中のワープポイント数が${initial.warps}です。`);
  assert(initial.stageId === "knowledge-01", "初期ステージが正しくありません。");
  assert(initial.playZoneSize.join("x") === "9x9", "中央プレイエリアが9×9ではありません。");
  assert(initial.playZonePosition.join(",") === "1,2", "中央プレイエリアが上から3行目にありません。");
  assert(initial.stageNumberSize.join("x") === "7x2", "ステージ番号が7×2ではありません。");
  assert(initial.settingsSize.join("x") === "2x2", "設定ボタンが2×2ではありません。");
  assert(initial.hintSize.join("x") === "2x2", "ヒントボタンが2×2ではありません。");
  assert(initial.topUiPositions.settings.join(",") === "0,0", "設定ボタンが左上の2×2範囲にありません。");
  assert(initial.topUiPositions.stage.join(",") === "2,0", "ステージ表示が上端の3列目から始まっていません。");
  assert(initial.topUiPositions.hint.join(",") === "9,0", "ヒントボタンが右上の2×2範囲にありません。");
  assert(initial.bottomUiPositions.up.join(",") === "3,12", "上ボタンの位置が違います。");
  assert(initial.bottomUiPositions.left.join(",") === "1,14", "左ボタンの位置が違います。");
  assert(initial.bottomUiPositions.right.join(",") === "5,14", "右ボタンの位置が違います。");
  assert(initial.bottomUiPositions.down.join(",") === "3,16", "下ボタンの位置が違います。");
  assert(initial.bottomUiPositions.action.join(",") === "8,12", "Aボタンの位置が違います。");
  assert(initial.bottomUiPositions.undo.join(",") === "8,16", "Uボタンの位置が違います。");
  assert(initial.actionRightColumns === 1 && initial.undoRightColumns === 1, "A/Uボタン右側の余白が1列ではありません。");
  assert(initial.playerPose === "idle", "勇者の初期状態が通常画像ではありません。");
  assert(initial.playerSprite.includes("hero-right-idle.png"), "初期方向の勇者画像が違います。");
  assert(!initial.hasStatusText, "十字ボタン上の説明テキストが残っています。");
  assert(Math.abs(initial.ratio - 11 / 19) < 0.002, `盤面比率が${initial.ratio}です。`);
  assert(initial.landOverhangs && initial.panelOverhangs, "LandまたはPanelの下への出っ張りがありません。");
  assert(initial.landFitsGridWidth && initial.panelFitsGridWidth, "地形がグリッド幅からずれています。");
  assert(initial.lowerPanelIsAbove, "下の行のPanelが前面になっていません。");
  assert(initial.seaColor === "rgb(46, 167, 224)", `Seaの色が素材と違います: ${initial.seaColor}`);
  assert(initial.seaImage.includes("sea.webp"), "Sea素材が使われていません。");
  assert(initial.seaImageSize === "100% 100%", `Sea素材が拡大されています: ${initial.seaImageSize}`);
  assert(initial.seaFitsGrid, "Sea素材が1マスの大きさに収まっていません。");
  assert(initial.seaTilesTouch, "Seaタイル同士の位置がずれています。");
  assert(initial.warpLogicalSize.join("x") === "1x1", "ワープポイントの論理サイズが1マスではありません。");
  assert(initial.warpSprite.includes("warp-point.png"), "追加されたワープポイント素材が使われていません。");
  assert(initial.topUiVisualsInset, "上部UIの画像に論理判定内の余白がありません。");
  assert(initial.stageNumberIsHorizontal, "ステージ番号が横並びではありません。");
  assert(initial.panelColor === "rgb(199, 165, 204)", `Panelの色が素材と違います: ${initial.panelColor}`);
  assert(initial.landColor === "rgb(57, 181, 74)", `Landの色が素材と違います: ${initial.landColor}`);
  assert(initial.panelSide.includes("rgb(138, 114, 143)"), "Panel側面の色が素材と違います。");
  assert(initial.landSide.includes("rgb(166, 124, 82)"), "Land側面の色が素材と違います。");
  const expectedUiAssets = {
    settings: "settings-button.webp",
    stage: "stage-display.webp",
    hint: "hint-button.webp",
    direction: "direction-button.webp",
    action: "action-button.webp",
    undo: "undo-button.webp",
  };
  Object.entries(expectedUiAssets).forEach(([key, fileName]) => {
    assert(initial.uiAssets[key].includes(fileName), `${fileName} が使われていません。`);
  });
  assert(!initial.horizontalOverflow && !initial.verticalOverflow, "ページに不要なスクロールがあります。");

  assert(initial.touchGesturesDisabled, "The game board still permits browser touch gestures.");
  assert(initial.selectionDisabled, "The game board still permits long-press selection.");
  assert(initial.footstepSoundSource.includes("asset/footstep.mp3"), "The footstep sound is not loaded.");
  assert(initial.warpSoundSource.includes("asset/warp.mp3"), "The warp sound is not loaded.");
  assert(initial.footstepSnippetDuration === 500, "The footstep sound is not trimmed to 500ms at playback.");
  assert(initial.environmentTimerStarted, "The SEA/warp alternating timer did not start.");
  assert(initial.environmentFlipInterval === 1600, "The SEA/warp alternating interval is unexpected.");
  assert(initial.seaFlipIsInstant, "SEA still becomes narrow while flipping.");
  assert(initial.warpFlipIsInstant, "The warp still becomes narrow while flipping.");

  const result = await evaluate(`(async () => {
    const click = (action) => document.querySelector('[data-action="' + action + '"]').click();
    const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
    const playedSoundPaths = [];
    const pausedSoundPaths = [];
    HTMLMediaElement.prototype.play = function playForTest() {
      playedSoundPaths.push(this.currentSrc || this.src);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pauseForTest() {
      pausedSoundPaths.push(this.currentSrc || this.src);
    };

    const seaIsBlocked = !isWalkable(3, 5);
    const landIsWalkable = isWalkable(3, 6);
    const panelIsWalkable = isWalkable(10, 7);

    window.clearInterval(environmentFlipTimer);
    environmentFlipTimer = null;
    const animatedSea = document.querySelector('[data-object-kind="sea"]');
    const animatedWarp = document.querySelector(".warp-point__sprite");
    animatedSea.style.transition = "none";
    animatedWarp.style.transition = "none";
    document.querySelector("#stage").classList.remove("is-environment-flipped");
    void animatedSea.offsetWidth;
    document.querySelector("#stage").classList.add("is-environment-flipped");
    const seaFlipMatrix = new DOMMatrix(getComputedStyle(animatedSea).transform);
    const warpFlipMatrix = new DOMMatrix(getComputedStyle(animatedWarp).transform);
    const seaFlipsHorizontally = seaFlipMatrix.a < 0 && seaFlipMatrix.d > 0;
    const warpFlipsHorizontally = warpFlipMatrix.a < 0 && warpFlipMatrix.d > 0;
    document.querySelector("#stage").classList.remove("is-environment-flipped");
    const movementTimingIsCalmer = PLAYER_MOVE_DURATION >= 200
      && HOLD_REPEAT_INTERVAL > PLAYER_MOVE_DURATION
      && BUTTON_STEP_DELAY > PLAYER_MOVE_DURATION;
    playFootstepSound();
    const footstepTimerScheduled = footstepStopTimer !== null;
    const pauseCountAfterFootstepStart = pausedSoundPaths.length;
    await wait(FOOTSTEP_SNIPPET_DURATION + 40);
    const footstepSnippetStopped = footstepStopTimer === null
      && pausedSoundPaths.length > pauseCountAfterFootstepStart
      && pausedSoundPaths.at(-1).includes("asset/footstep.mp3");

    click("interact");
    const attackPose = document.querySelector("#player").dataset.pose;
    const attackSprite = document.querySelector("#player .player-sprite").src;
    await wait(ATTACK_DURATION + 60);
    const returnedPose = document.querySelector("#player").dataset.pose;
    const returnedSprite = document.querySelector("#player .player-sprite").src;

    const resetPlayer = () => {
      clearButtonMotion();
      clearAttack();
      clearDirectionRepeats();
      clearUndoRepeats();
      clearWarpExit();
      state.manualInputSources.clear();
      state.pressedControlSources.clear();
      state.activeDirectionPointerSources.clear();
      state.currentStageIndex = 0;
      state.player = { ...currentStage().start };
      state.history = [];
      state.lastRenderedPlayer = null;
      state.warpArrivalKey = null;
      render();
    };

    resetPlayer();
    const footstepPlayCountBeforeMove = playedSoundPaths
      .filter((path) => path.includes("asset/footstep.mp3")).length;
    pressDirection("test:short-hold", "right");
    const footstepPlayedOnMove = playedSoundPaths
      .filter((path) => path.includes("asset/footstep.mp3")).length > footstepPlayCountBeforeMove;
    await wait(HOLD_REPEAT_DELAY - 80);
    releaseDirection("test:short-hold");
    const shortHoldX = state.player.x;
    await wait(HOLD_REPEAT_INTERVAL + 60);
    const shortHoldSettledX = state.player.x;

    resetPlayer();
    pressDirection("test:long-hold", "right");
    const longHoldImmediateX = state.player.x;
    await wait(HOLD_REPEAT_DELAY + HOLD_REPEAT_INTERVAL * 2 + 50);
    releaseDirection("test:long-hold");
    const longHoldX = state.player.x;
    await wait(HOLD_REPEAT_INTERVAL + 60);
    const longHoldSettledX = state.player.x;

    resetPlayer();

    const directionPointerId = 71;
    document.querySelector('[data-action="move-right"]').dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: directionPointerId,
      button: 0,
      buttons: 1,
    }));
    const directionInputDark = document.querySelector('[data-action="move-right"]')
      .classList.contains("is-input-pressed");
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: directionPointerId,
      button: 0,
      buttons: 0,
    }));
    const directionInputReleased = !document.querySelector('[data-action="move-right"]')
      .classList.contains("is-input-pressed");

    resetPlayer();
    const stageElement = document.querySelector("#stage");
    const slidePointerId = 73;
    const slideSourceId = "pointer:" + slidePointerId;
    document.querySelector('[data-action="move-right"]').dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: slidePointerId,
      button: 0,
      buttons: 1,
    }));
    const slideRightPosition = [state.player.x, state.player.y];

    const movePointerTo = (element) => {
      const bounds = element.getBoundingClientRect();
      stageElement.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: slidePointerId,
        buttons: 1,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      }));
    };

    movePointerTo(document.querySelector('[data-action="move-up"]'));
    const slideUpPosition = [state.player.x, state.player.y];
    const slideChangedToUp = state.manualInputSources.get(slideSourceId) === "up"
      && document.querySelector('[data-action="move-up"]').classList.contains("is-input-pressed")
      && !document.querySelector('[data-action="move-right"]').classList.contains("is-input-pressed");

    const stageBounds = stageElement.getBoundingClientRect();
    stageElement.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: slidePointerId,
      buttons: 1,
      clientX: stageBounds.left + (5.5 * stageBounds.width / 11),
      clientY: stageBounds.top + (12.5 * stageBounds.height / 19),
    }));
    const slideStoppedInGap = !state.manualInputSources.has(slideSourceId)
      && !document.querySelector('[data-action="move-up"]').classList.contains("is-input-pressed");

    movePointerTo(document.querySelector('[data-action="move-left"]'));
    const slideLeftPosition = [state.player.x, state.player.y];
    const slideRestartedAsLeft = state.manualInputSources.get(slideSourceId) === "left"
      && document.querySelector('[data-action="move-left"]').classList.contains("is-input-pressed");
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: slidePointerId,
      button: 0,
      buttons: 0,
    }));
    const slideReleased = !state.activeDirectionPointerSources.has(slideSourceId)
      && !state.manualInputSources.has(slideSourceId)
      && !document.querySelector('[data-action="move-left"]').classList.contains("is-input-pressed");

    const contextMenuEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.querySelector('[data-action="move-up"]').dispatchEvent(contextMenuEvent);
    const selectStartEvent = new Event("selectstart", { bubbles: true, cancelable: true });
    document.querySelector('[data-action="move-up"]').dispatchEvent(selectStartEvent);
    const dragStartEvent = new Event("dragstart", { bubbles: true, cancelable: true });
    document.querySelector('[data-action="move-up"]').dispatchEvent(dragStartEvent);
    const longPressEventsBlocked = contextMenuEvent.defaultPrevented
      && selectStartEvent.defaultPrevented
      && dragStartEvent.defaultPrevented;

    const actionPointerId = 72;
    document.querySelector('[data-action="interact"]').dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: actionPointerId,
      button: 0,
      buttons: 1,
    }));
    const actionInputDark = document.querySelector('[data-action="interact"]')
      .classList.contains("is-input-pressed");
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: actionPointerId,
      button: 0,
      buttons: 0,
    }));
    const actionInputReleased = !document.querySelector('[data-action="interact"]')
      .classList.contains("is-input-pressed");

    resetPlayer();
    for (let index = 0; index < 3; index += 1) click("move-right");
    const shortUndoPointerId = 74;
    document.querySelector('[data-action="undo"]').dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: shortUndoPointerId,
      button: 0,
      buttons: 1,
    }));
    const shortUndoImmediateX = state.player.x;
    const shortUndoInputDark = document.querySelector('[data-action="undo"]')
      .classList.contains("is-input-pressed");
    await wait(UNDO_REPEAT_DELAY - 80);
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: shortUndoPointerId,
      button: 0,
      buttons: 0,
    }));
    const shortUndoReleased = !document.querySelector('[data-action="undo"]')
      .classList.contains("is-input-pressed");
    await wait(UNDO_REPEAT_INTERVAL + 60);
    const shortUndoSettledX = state.player.x;

    resetPlayer();
    for (let index = 0; index < 4; index += 1) click("move-right");
    const longUndoPointerId = 75;
    document.querySelector('[data-action="undo"]').dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: longUndoPointerId,
      button: 0,
      buttons: 1,
    }));
    const longUndoImmediateX = state.player.x;
    await wait(UNDO_REPEAT_DELAY + UNDO_REPEAT_INTERVAL + 50);
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: longUndoPointerId,
      button: 0,
      buttons: 0,
    }));
    const longUndoX = state.player.x;
    await wait(UNDO_REPEAT_INTERVAL + 60);
    const longUndoSettledX = state.player.x;
    const undoRepeatReleased = state.activeUndoSources.size === 0
      && state.undoRepeatTimers.size === 0;

    resetPlayer();

    click("move-right");
    const movementAnimation = document.querySelector("#player").getAnimations()[0];
    const movementFrames = movementAnimation?.effect.getKeyframes() ?? [];
    const smoothMoveStarted = movementFrames.length === 2
      && movementFrames[0].transform !== movementFrames[1].transform
      && movementAnimation.effect.getTiming().duration === PLAYER_MOVE_DURATION;
    state.player = { x: 9, y: 7, facing: "right" };
    state.warpArrivalKey = warpKey(0, warpAt(0, 9, 7));
    state.lastRenderedPlayer = null;
    render();
    click("move-right");
    const xOutsidePlayZone = document.querySelector("#player").dataset.x;
    for (let index = 0; index < 6; index += 1) click("move-up");
    const yInTopUiArea = document.querySelector("#player").dataset.y;
    const topUiSprite = document.querySelector("#player .player-sprite").src;

    state.player = { x: 3, y: 11, facing: "down" };
    render();
    click("move-down");
    const yOnUpButton = document.querySelector("#player").dataset.y;
    const upButtonDark = document.querySelector('[data-object-id="move-up"]').classList.contains("is-player-pressed");
    await wait(BUTTON_STEP_DELAY + 60);
    const yAfterAutomaticMove = document.querySelector("#player").dataset.y;

    state.player = { x: 8, y: 11, facing: "down" };
    state.message = "";
    render();
    click("move-down");
    const aButtonTriggered = state.message === "剣を振りました";
    const aButtonDark = document.querySelector('[data-object-id="interact"]').classList.contains("is-player-pressed");
    const aButtonAttackPose = document.querySelector("#player").dataset.pose;
    const aButtonAttackSprite = document.querySelector("#player .player-sprite").src;

    resetPlayer();
    state.player = { x: 8, y: 7, facing: "right" };
    render();
    const warpPlayCountBeforeActivation = playedSoundPaths
      .filter((path) => path.includes("asset/warp.mp3")).length;
    click("move-right");
    const sourceWarpStage = state.currentStageIndex;
    const sourceWarpPosition = [state.player.x, state.player.y];
    const sourceWarpIsObservable = Boolean(
      warpAt(state.currentStageIndex, state.player.x, state.player.y)
      && state.pendingWarpExit?.phase === "activating"
    );
    click("move-left");
    const inputBlockedWhileActivating = state.currentStageIndex === 0
      && state.player.x === 9
      && state.player.y === 7;
    await wait(WARP_ACTIVATION_DELAY + 30);
    const warpSoundPlayedOnActivation = playedSoundPaths
      .filter((path) => path.includes("asset/warp.mp3")).length > warpPlayCountBeforeActivation;
    const firstWarpStage = state.currentStageIndex;
    const firstWarpPosition = [state.player.x, state.player.y];
    const firstWarpIsObservable = Boolean(
      warpAt(state.currentStageIndex, state.player.x, state.player.y)
      && state.pendingWarpExit?.phase === "waiting"
    );
    const footstepPlayCountBeforeWarpExit = playedSoundPaths
      .filter((path) => path.includes("asset/footstep.mp3")).length;
    await wait(WARP_EXIT_DELAY + 30);
    const footstepPlayedOnWarpExit = playedSoundPaths
      .filter((path) => path.includes("asset/footstep.mp3")).length > footstepPlayCountBeforeWarpExit;
    const firstWarpExitPosition = [state.player.x, state.player.y];
    const warpExitAnimation = document.querySelector("#player").getAnimations()[0];
    const warpExitFrames = warpExitAnimation?.effect.getKeyframes() ?? [];
    const warpExitIsAnimated = state.pendingWarpExit?.phase === "moving"
      && warpExitFrames.length === 2
      && warpExitFrames[0].transform !== warpExitFrames[1].transform
      && warpExitAnimation.effect.getTiming().duration === PLAYER_MOVE_DURATION;
    const firstWarpExitIsClear = !warpAt(state.currentStageIndex, state.player.x, state.player.y)
      && state.warpArrivalKey === null;
    await wait(PLAYER_MOVE_DURATION + 30);
    const warpSequenceFinished = state.pendingWarpExit === null;
    undo();
    const undoAfterWarp = state.currentStageIndex === 0
      && state.player.x === 8
      && state.player.y === 7;

    state.currentStageIndex = 1;
    state.player = { x: 8, y: 7, facing: "right" };
    state.history = [];
    state.lastRenderedPlayer = null;
    render();
    click("move-right");
    const secondWarpSourceStage = state.currentStageIndex;
    await wait(WARP_ACTIVATION_DELAY + 30);
    const secondWarpArrivalStage = state.currentStageIndex;
    const secondWarpArrivalPosition = [state.player.x, state.player.y];
    await wait(WARP_EXIT_DELAY + PLAYER_MOVE_DURATION + 30);
    const secondWarpStage = state.currentStageIndex;
    const secondWarpPosition = [state.player.x, state.player.y];

    click("move-left");
    const reverseWarpSourceStage = state.currentStageIndex;
    await wait(WARP_ACTIVATION_DELAY + 30);
    const reverseWarpArrivalStage = state.currentStageIndex;
    const reverseWarpArrivalPosition = [state.player.x, state.player.y];
    await wait(WARP_EXIT_DELAY + PLAYER_MOVE_DURATION + 30);
    const reverseWarpStage = state.currentStageIndex;
    const reverseWarpPosition = [state.player.x, state.player.y];
    const upwardWarp = nearestWarpInDirection(1, warpAt(1, 9, 7), "up");

    resetPlayer();
    state.player = { x: 10, y: 0, facing: "right" };
    render();
    click("move-right");
    const connectedStage = state.currentStageIndex;
    const connectedPosition = [state.player.x, state.player.y];
    undo();
    const undoAcrossStage = state.currentStageIndex === 0
      && state.player.x === 10
      && state.player.y === 0;

    return {
      seaIsBlocked,
      landIsWalkable,
      panelIsWalkable,
      seaFlipsHorizontally,
      warpFlipsHorizontally,
      movementTimingIsCalmer,
      footstepTimerScheduled,
      footstepSnippetStopped,
      attackPose,
      attackSprite,
      returnedPose,
      returnedSprite,
      shortHoldX,
      shortHoldSettledX,
      footstepPlayedOnMove,
      longHoldImmediateX,
      longHoldX,
      longHoldSettledX,
      directionInputDark,
      directionInputReleased,
      slideRightPosition,
      slideUpPosition,
      slideChangedToUp,
      slideStoppedInGap,
      slideLeftPosition,
      slideRestartedAsLeft,
      slideReleased,
      longPressEventsBlocked,
      actionInputDark,
      actionInputReleased,
      shortUndoImmediateX,
      shortUndoInputDark,
      shortUndoReleased,
      shortUndoSettledX,
      longUndoImmediateX,
      longUndoX,
      longUndoSettledX,
      undoRepeatReleased,
      smoothMoveStarted,
      xOutsidePlayZone,
      yInTopUiArea,
      topUiSprite,
      yOnUpButton,
      upButtonDark,
      yAfterAutomaticMove,
      aButtonTriggered,
      aButtonDark,
      aButtonAttackPose,
      aButtonAttackSprite,
      sourceWarpStage,
      sourceWarpPosition,
      sourceWarpIsObservable,
      inputBlockedWhileActivating,
      warpSoundPlayedOnActivation,
      firstWarpStage,
      firstWarpPosition,
      firstWarpIsObservable,
      footstepPlayedOnWarpExit,
      firstWarpExitPosition,
      warpExitIsAnimated,
      firstWarpExitIsClear,
      warpSequenceFinished,
      undoAfterWarp,
      secondWarpSourceStage,
      secondWarpArrivalStage,
      secondWarpArrivalPosition,
      secondWarpStage,
      secondWarpPosition,
      reverseWarpSourceStage,
      reverseWarpArrivalStage,
      reverseWarpArrivalPosition,
      reverseWarpStage,
      reverseWarpPosition,
      upwardWarp,
      connectedStage,
      connectedPosition,
      undoAcrossStage,
    };
  })()`);

  assert(result.seaIsBlocked, "Seaが通行不可になっていません。");
  assert(result.landIsWalkable, "Landを歩けません。");
  assert(result.panelIsWalkable, "Purple Panelを歩けません。");
  assert(result.attackPose === "attack", "Aを押しても攻撃状態になりません。");
  assert(result.attackSprite.includes("hero-right-attack.png"), "向いている方向の攻撃画像になりません。");
  assert(result.returnedPose === "idle", "攻撃後に通常状態へ戻りません。");
  assert(result.returnedSprite.includes("hero-right-idle.png"), "攻撃後に通常画像へ戻りません。");
  assert(result.shortHoldX === 4, "短い押下の初回1マスが反映されません。");
  assert(result.shortHoldSettledX === 4, "短い押下で複数マス移動してしまいます。");
  assert(result.longHoldImmediateX === 4, "長押し開始時に最初の1マスを移動しません。");
  assert(result.longHoldX === 7, `長押しの反復位置が${result.longHoldX}です。`);
  assert(result.longHoldSettledX === 7, "長押しを離した後も移動が続いています。");
  assert(result.directionInputDark, "方向ボタンを押している間に暗くなりません。");
  assert(result.directionInputReleased, "方向ボタンを離しても暗いままです。");
  assert(result.actionInputDark, "Aボタンを押している間に暗くなりません。");
  assert(result.actionInputReleased, "Aボタンを離しても暗いままです。");
  assert(result.smoothMoveStarted, "1マス移動の表示補間が開始されません。");
  assert(result.xOutsidePlayZone === "10", "Landから外周Panelへ出られません。");
  assert(result.yInTopUiArea === "1", "画面上部をステージとして歩けません。");
  assert(result.topUiSprite.includes("hero-up-idle.png"), "移動方向と勇者画像が同期していません。");
  assert(result.yOnUpButton === "12", "上ボタンへ乗れません。");
  assert(result.upButtonDark, "勇者が乗った矢印ボタンが暗くなりません。");
  assert(result.yAfterAutomaticMove === "11", "上ボタンへ乗った直後に自動移動しません。");
  assert(result.aButtonTriggered, "勇者が踏んだAボタンが作動しません。");
  assert(result.aButtonDark, "勇者が乗ったAボタンが暗くなりません。");
  assert(result.aButtonAttackPose === "attack", "勇者が踏んだAボタンで剣を振りません。");
  assert(result.aButtonAttackSprite.includes("hero-down-attack.png"), "踏んだAボタンの攻撃方向が違います。");
  assert(result.sourceWarpStage === 0, "ワープへ入った瞬間に別ステージへ切り替わっています。");
  assert(result.sourceWarpPosition.join(",") === "9,7", "ワープ元で待機する位置が違います。");
  assert(result.sourceWarpIsObservable, "入った側のワープ上で発動を待つ段階がありません。");
  assert(result.inputBlockedWhileActivating, "ワープ発動待機中に別の移動入力が割り込んでいます。");
  assert(result.firstWarpStage === 1, "右向き進入で右隣のワープへ移動しません。");
  assert(result.firstWarpPosition.join(",") === "9,7", "ワープ直後に移動先ワープ上へ表示されません。");
  assert(result.firstWarpIsObservable, "ワープ上で待機する段階をプレイヤーが観測できません。");
  assert(result.firstWarpExitPosition.join(",") === "10,7", "待機後に進入方向へ1マス退出しません。");
  assert(result.warpExitIsAnimated, "ワープ上から出口への1マス移動が表示されていません。");
  assert(result.firstWarpExitIsClear, "ワープ後も勇者がワープポイント上に残っています。");
  assert(result.warpSequenceFinished, "退出アニメーション後もワープ処理が残っています。");
  assert(result.undoAfterWarp, "ワープと出口への移動を一度にUNDOできません。");
  assert(result.secondWarpSourceStage === 1, "連続ワープが入った瞬間に切り替わっています。");
  assert(result.secondWarpArrivalStage === 2, "連続ワープの待機後に移動先へ切り替わりません。");
  assert(result.secondWarpArrivalPosition.join(",") === "9,7", "連続ワープの到着表示位置が違います。");
  assert(result.secondWarpStage === 2, "同じ行の右側で最も近いワープを選んでいません。");
  assert(result.secondWarpPosition.join(",") === "10,7", "連続する右向きワープの出口位置が違います。");
  assert(result.reverseWarpSourceStage === 2, "逆向きワープが入った瞬間に切り替わっています。");
  assert(result.reverseWarpArrivalStage === 1, "逆向きワープの待機後に移動先へ切り替わりません。");
  assert(result.reverseWarpArrivalPosition.join(",") === "9,7", "左向きワープの到着表示位置が違います。");
  assert(result.reverseWarpStage === 1, "左向き進入で左側の最寄りワープへ戻りません。");
  assert(result.reverseWarpPosition.join(",") === "8,7", "左向きワープ後に出口の左隣へ移動しません。");
  assert(result.upwardWarp === null, "同じ列にないワープを上下方向の候補にしています。");
  assert(result.connectedStage === 1, "画面端から地続きの隣接ステージへ移動できません。");
  assert(result.connectedPosition.join(",") === "0,0", "隣接ステージでの接続座標が違います。");
  assert(result.undoAcrossStage, "ステージをまたぐ移動を一手戻しできません。");

  assert(result.slideRightPosition.join(",") === "4,7", "Slide input did not begin with one move to the right.");
  assert(result.slideUpPosition.join(",") === "4,6", "Sliding onto Up did not switch direction immediately.");
  assert(result.slideChangedToUp, "The pressed state did not switch from Right to Up.");
  assert(result.slideStoppedInGap, "Direction input did not stop in the D-pad gap.");
  assert(result.slideLeftPosition.join(",") === "3,6", "Sliding from the gap onto Left did not move immediately.");
  assert(result.slideRestartedAsLeft, "Left did not become pressed after re-entering the D-pad.");
  assert(result.slideReleased, "Direction input remained active after the pointer was released.");
  assert(result.longPressEventsBlocked, "Long-press selection, menu, or drag events were not prevented.");
  assert(result.seaFlipsHorizontally, "SEA tiles do not alternate horizontally.");
  assert(result.warpFlipsHorizontally, "The warp point does not alternate horizontally.");
  assert(result.movementTimingIsCalmer, "Movement repeats before its visual transition can settle.");
  assert(result.footstepTimerScheduled, "The 500ms footstep stop timer was not scheduled.");
  assert(result.footstepSnippetStopped, "The footstep sound did not stop after its first 500ms.");
  assert(result.footstepPlayedOnMove, "Moving one cell did not play the footstep sound.");
  assert(result.warpSoundPlayedOnActivation, "Warp activation did not play the warp sound.");
  assert(result.footstepPlayedOnWarpExit, "Leaving a warp did not play the footstep sound.");
  assert(result.shortUndoImmediateX === 5, "A short UNDO press did not undo exactly one move immediately.");
  assert(result.shortUndoInputDark, "The UNDO button was not dark while held.");
  assert(result.shortUndoReleased, "The UNDO button remained dark after release.");
  assert(result.shortUndoSettledX === 5, "A short UNDO press repeated unexpectedly.");
  assert(result.longUndoImmediateX === 6, "A long UNDO press did not undo once immediately.");
  assert(result.longUndoX === 4, "Holding UNDO did not repeat at the expected rate.");
  assert(result.longUndoSettledX === 4, "UNDO continued repeating after release.");
  assert(result.undoRepeatReleased, "UNDO repeat state was not cleaned up after release.");

  console.log("smoke test: ok");
} finally {
  socket.close();
  browser.kill();
  await Promise.race([
    new Promise((resolveExit) => browser.once("exit", resolveExit)),
    delay(3000),
  ]);
  rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
