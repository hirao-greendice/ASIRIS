import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createPortProbe } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browserPath = browserCandidates.find(existsSync);
if (!browserPath) throw new Error("ChromeまたはEdgeが見つかりません。");

[
  "data/game-content.json",
  "asset/settings-button.webp",
  "asset/hint-button.webp",
  "asset/sword-guide.png",
  "asset/warp-point.png",
  "asset/footstep.mp3",
  "asset/warp.mp3",
  ...["up", "right", "down", "left"]
    .flatMap((direction) => ["idle", "attack"].map((pose) => `asset/hero-${direction}-${pose}.png`)),
].forEach((relativePath) => {
  if (!existsSync(resolve(projectRoot, relativePath))) {
    throw new Error(`必要なファイル ${relativePath} が見つかりません。`);
  }
});

const content = JSON.parse(readFileSync(resolve(projectRoot, "data/game-content.json"), "utf8"));
if (content.version !== 2) throw new Error("game-content.jsonのversionが違います。");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
};

const webServer = createHttpServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    let filePath = resolve(projectRoot, `.${pathname}`);
    if (filePath === projectRoot || statSync(filePath).isDirectory()) filePath = resolve(filePath, "index.html");
    if (!filePath.startsWith(`${projectRoot}${sep}`)) throw new Error("invalid path");
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
    response.end(readFileSync(filePath));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolveListen, rejectListen) => {
  webServer.once("error", rejectListen);
  webServer.listen(0, "127.0.0.1", resolveListen);
});
const webPort = webServer.address().port;
const pageUrl = `http://127.0.0.1:${webPort}/index.html`;

const debugPort = await new Promise((resolvePort, rejectPort) => {
  const probe = createPortProbe();
  probe.on("error", rejectPort);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolvePort(address.port));
  });
});

const profileDirectory = mkdtempSync(join(tmpdir(), "asiris-smoke-"));
const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDirectory}`,
  pageUrl,
], { stdio: "ignore" });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function findPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((entry) => entry.type === "page" && entry.url === pageUrl);
      if (page) return page;
    } catch {
      // デバッグポートが開くまで待つ。
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
    height: 860,
    deviceScaleFactor: 1,
    mobile: true,
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate("typeof state !== 'undefined' && state.isReady")) break;
    await delay(50);
  }
  assert(await evaluate("state.isReady"), "JSON読み込み後にゲームが開始されません。");

  const initial = await evaluate(`(() => {
    const stage = document.querySelector("#stage");
    const hud = document.querySelector(".top-hud");
    const frame = document.querySelector(".game-frame");
    const playZone = document.querySelector('[data-object-id="play-zone"]');
    const up = document.querySelector('[data-object-id="move-up"]');
    const left = document.querySelector('[data-object-id="move-left"]');
    const right = document.querySelector('[data-object-id="move-right"]');
    const down = document.querySelector('[data-object-id="move-down"]');
    const action = document.querySelector('[data-object-id="interact"]');
    const undoButton = document.querySelector('[data-object-id="undo"]');
    const stageBounds = stage.getBoundingClientRect();
    const hudBounds = hud.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    return {
      stageCount: STAGES.length,
      stageId: stage.dataset.stageId,
      stageMapSizes: STAGES.map((entry) => [entry.map.length, ...new Set(entry.map.map((row) => [...row].length))]),
      stagesAreIndependent: STAGES.every((entry) => !("position" in entry)),
      panelCount: document.querySelectorAll('[data-object-kind="panel"]').length,
      seaCount: document.querySelectorAll('[data-object-kind="sea"]').length,
      playZone: [playZone.dataset.x, playZone.dataset.y, playZone.dataset.width, playZone.dataset.height],
      start: [state.player.x, state.player.y, state.player.facing],
      controls: {
        up: [up.dataset.x, up.dataset.y],
        left: [left.dataset.x, left.dataset.y],
        right: [right.dataset.x, right.dataset.y],
        down: [down.dataset.x, down.dataset.y],
        action: [action.dataset.x, action.dataset.y],
        undo: [undoButton.dataset.x, undoButton.dataset.y],
      },
      hudOutsideStage: hud.parentElement === frame
        && stage.parentElement === frame
        && !stage.contains(hud)
        && hudBounds.bottom <= stageBounds.top + 0.1,
      frameRatio: frameBounds.width / frameBounds.height,
      stageRatio: stageBounds.width / stageBounds.height,
      grayBackground: getComputedStyle(hud).backgroundColor,
      pinkBackground: getComputedStyle(stage).backgroundColor,
      hudButtons: document.querySelectorAll(".top-hud .hud-button").length,
      oldTopButtonsInStage: stage.querySelectorAll('[data-object-id="settings"], [data-object-id="hint"], [data-object-id="stage-number"]').length,
      title: document.querySelector("#hud-stage-number").textContent,
      dialogueConfigured: Object.keys(DIALOGUES).length === STAGES.length
        && Object.values(DIALOGUES).every((entries) => entries.some((entry) => entry.trigger?.event === "stage-start")),
      dialogueDefaults: { ...DIALOGUE_DEFAULTS },
      mapPreserved: STAGES.find((entry) => entry.id === "stage-06").objects.filter((object) => object.kind === "direction").length === 19
        && STAGES.find((entry) => entry.id === "stage-07").objects.some((object) => object.id === "boss-07" && object.y === 13),
      touchSafe: getComputedStyle(stage).touchAction === "none"
        && getComputedStyle(stage).userSelect === "none"
        && getComputedStyle(hud).userSelect === "none",
      noOverflow: document.documentElement.scrollWidth <= innerWidth
        && document.documentElement.scrollHeight <= innerHeight,
    };
  })()`);

  assert(initial.stageCount === 9, `ステージ数が${initial.stageCount}です。`);
  assert(initial.stageId === "stage-01", "初期ステージがStage 1ではありません。");
  assert(initial.stageMapSizes.every(([rows, columns]) => rows === 18 && columns === 11), "JSON盤面が11×18で統一されていません。");
  assert(initial.stagesAreIndependent, "旧ワールド座標がステージ定義に残っています。");
  assert(initial.panelCount === 11 * 18 - 9 * 9, "Purple Panelの枚数が違います。");
  assert(initial.seaCount === 9 * 9, "SEAが1マスずつ81枚描画されていません。");
  assert(initial.playZone.join(",") === "1,1,9,9", "中央プレイエリアの位置または大きさが違います。");
  assert(initial.start.join(",") === "3,5,right", "JSONの開始位置が反映されていません。");
  assert(initial.controls.up.join(",") === "3,11" && initial.controls.down.join(",") === "3,15", "上下ボタンの位置が違います。");
  assert(initial.controls.left.join(",") === "1,13" && initial.controls.right.join(",") === "5,13", "左右ボタンの位置が違います。");
  assert(initial.controls.action.join(",") === "8,11" && initial.controls.undo.join(",") === "8,15", "A/Uボタンの位置が違います。");
  assert(initial.hudOutsideStage, "灰色HUDがステージ領域に入り込んでいます。");
  assert(Math.abs(initial.frameRatio - 11 / 22) < 0.01, "全体が11×22相当の比率ではありません。");
  assert(Math.abs(initial.stageRatio - 11 / 18) < 0.01, "ピンクのステージが11×18の比率ではありません。");
  assert(initial.grayBackground === "rgb(85, 85, 85)", "字幕領域の背景が灰色ではありません。");
  assert(initial.pinkBackground === "rgb(199, 165, 204)", "ステージ領域の背景がPurple Panel色ではありません。");
  assert(initial.hudButtons === 2 && initial.oldTopButtonsInStage === 0, "上部UIが盤面オブジェクトとして残っています。");
  assert(initial.title === "1", "HUDのステージ表示が違います。");
  assert(initial.dialogueConfigured, "各ステージの開始字幕がJSONにまとまっていません。");
  assert(initial.dialogueDefaults.characterIntervalMs > 0 && initial.dialogueDefaults.startDelayMs >= 0, "文字送り設定が読み込まれていません。");
  assert(initial.mapPreserved, "既存の矢印または画面外ボスがJSON移行で失われています。");
  assert(initial.touchSafe, "長押し選択を防ぐ設定が不足しています。");
  assert(initial.noOverflow, "スマホ表示で画面がスクロールします。");

  if (process.env.CAPTURE_PREVIEW) {
    await delay(1300);
    const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(resolve(projectRoot, "preview.png"), Buffer.from(screenshot.data, "base64"));
  }

  const movement = await evaluate(`(() => {
    const seaBlocked = !isWalkable(1, 1, 0);
    const landWalkable = isWalkable(3, 5, 0);
    const pinkWalkable = isWalkable(0, 0, 0);
    loadStage(0);
    state.player = { x: 10, y: 10, facing: "right" };
    state.history = [];
    render();
    performManualMove("right");
    return {
      seaBlocked,
      landWalkable,
      pinkWalkable,
      edgeStayedInStage: state.currentStageIndex === 0 && state.player.x === 10 && state.player.y === 10,
      noEdgeHistory: state.history.length === 0,
      unconfiguredWarpIsNull: nearestWarpInDirection(0, warpAt(0, 2, 2), "right") === null,
      configuredWarpTarget: nearestWarpInDirection(0, warpAt(0, 8, 5), "right")?.warp.id,
    };
  })()`);
  assert(movement.seaBlocked, "SEAを歩けます。");
  assert(movement.landWalkable, "Landを歩けません。");
  assert(movement.pinkWalkable, "ピンクのPurple Panelを歩けません。");
  assert(movement.edgeStayedInStage && movement.noEdgeHistory, "画面端から別ステージへ直接つながっています。");
  assert(movement.unconfiguredWarpIsNull, "JSONにないワープ経路が自動推測されています。");
  assert(movement.configuredWarpTarget === "warp-02-in", "JSONのワープ経路が反映されていません。");

  const dialogueStart = await evaluate(`(() => {
    clearDialogueTimers();
    showDialogue({ speaker: "guide", text: "確認" }, { instant: true });
    const guidePortrait = document.querySelector("#dialogue-portrait").getAttribute("src");
    showDialogue({ speaker: "hero", text: "文字送りテスト", characterIntervalMs: 70 });
    return {
      guidePortrait,
      firstText: document.querySelector("#dialogue-text").textContent,
      speaker: document.querySelector("#dialogue-speaker").textContent,
      portrait: document.querySelector("#dialogue-portrait").getAttribute("src"),
    };
  })()`);
  assert(dialogueStart.guidePortrait === "asset/sword-guide.png", "ソード君の字幕にソード素材が表示されません。");
  assert(dialogueStart.firstText === "文", "字幕が一文字ずつ開始されません。");
  assert(dialogueStart.speaker === "勇者", "話者設定が反映されていません。");
  assert(dialogueStart.portrait === "asset/hero-right-idle.png", "話者画像が反映されていません。");
  await delay(90);
  const dialogueMiddle = await evaluate("document.querySelector('#dialogue-text').textContent");
  assert(dialogueMiddle.length > 1 && dialogueMiddle.length < "文字送りテスト".length, "文字送りの途中状態を表示できません。");
  await delay(600);
  assert(await evaluate("document.querySelector('#dialogue-text').textContent === '文字送りテスト'"), "字幕が最後まで表示されません。");

  await evaluate("document.querySelector('.hud-button--hint').click()");
  await delay(500);
  const hint = await evaluate(`({
    speaker: document.querySelector("#dialogue-speaker").textContent,
    text: document.querySelector("#dialogue-text").textContent,
  })`);
  assert(hint.speaker === "SYSTEM" && hint.text.length > 0, "ヒントが字幕欄へ表示されません。");

  const warpSource = await evaluate(`(() => {
    loadStage(0);
    state.player = { x: 7, y: 5, facing: "right" };
    state.history = [];
    state.lastRenderedPlayer = null;
    render();
    performManualMove("right");
    return [state.currentStageIndex, state.player.x, state.player.y, state.pendingWarpExit?.phase];
  })()`);
  assert(warpSource.join(",") === "0,8,5,activating", "ワープ元で発動待機しません。");
  await delay(340);
  const warpArrival = await evaluate("[state.currentStageIndex, state.player.x, state.player.y, state.pendingWarpExit?.phase]");
  assert(warpArrival.join(",") === "1,2,5,waiting", "独立ステージの移動先ワープへ到着しません。");
  await delay(340);
  const warpExit = await evaluate("[state.currentStageIndex, state.player.x, state.player.y, state.pendingWarpExit?.phase]");
  assert(warpExit[0] === 1 && warpExit[1] === 3 && warpExit[2] === 5, "ワープ後に進入方向へ1マス退出しません。");

  console.log("smoke test: ok");
} finally {
  socket.close();
  browser.kill();
  await Promise.race([
    new Promise((resolveExit) => browser.once("exit", resolveExit)),
    delay(3000),
  ]);
  await new Promise((resolveClose) => webServer.close(resolveClose));
  rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
