import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const landingHtml = readFileSync(resolve(root, "index.html"), "utf8");
const landingCss = readFileSync(resolve(root, "style.css"), "utf8");
const html = readFileSync(resolve(root, "game.html"), "utf8");
const css = readFileSync(resolve(root, "game.css"), "utf8");
const game = readFileSync(resolve(root, "game.js"), "utf8");
const stagesSource = readFileSync(resolve(root, "stages.js"), "utf8");
const coloredPng = readFileSync(resolve(root, "colored.png"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes('width="192"') && html.includes('height="192"'), "Canvas内部サイズが192×192ではありません。");
assert(landingHtml.includes("迷いの森 - UIモック") && landingHtml.includes('src="script.js?v=20260903-4"'), "公開トップが最新UIになっていません。");
assert(landingCss.includes("--page-purple: #c9a8cf"), "公開トップのスタイルが最新UI用ではありません。");
assert(html.includes('src="stages.js?v=20260903-4"') && html.indexOf('src="stages.js?v=20260903-4"') < html.indexOf('src="game.js?v=20260903-4"'), "stages.jsをgame.jsより先に読み込んでいません。");
assert(html.includes('id="editor-palette"') && html.includes('id="debug-panel"'), "エディタまたはデバッグUIがありません。");
assert(css.includes("image-rendering: pixelated") && css.includes("image-rendering: crisp-edges"), "ピクセル表示のCSSがありません。");
assert(game.includes("const GRID_SIZE = 12") && game.includes("const TILE_SIZE = 16"), "12×12・16pxグリッドの定義がありません。");
assert(game.includes("column * ATLAS_STRIDE") && game.includes("row * ATLAS_STRIDE"), "17px間隔のatlas切り出し処理がありません。");
assert(game.includes("targetContext.scale(-1, 1)") && game.includes("globalAlpha"), "反転または半透明描画に対応していません。");
assert(game.includes("localStorage.setItem") && game.includes("localStorage.getItem"), "localStorageの保存・読込処理がありません。");
assert(game.includes('const STORAGE_KEY = "asiris-stage-editor-v2"'), "古いステージ保存データを無効化できていません。");
assert(coloredPng.readUInt32BE(16) === 832 && coloredPng.readUInt32BE(20) === 373, "colored.pngが832×373ではありません。");

const stageSandbox = {};
stageSandbox.globalThis = stageSandbox;
runInNewContext(stagesSource, stageSandbox);
const stages = stageSandbox.STAGES;
assert(Array.isArray(stages) && stages.length >= 1, "STAGESが定義されていません。");
assert(stages.every((stage) => stage.width === 12 && stage.height === 12), "12×12ではないステージがあります。");
assert(stages.every((stage) => stage.tiles.length === 12 && stage.tiles.every((row) => row.length === 12)), "tilesが12×12ではありません。");
assert(stages[0].objects.some((object) => object.type === "player"), "主人公が配置されていません。");
assert(stages[0].objects.some((object) => object.type === "sword"), "ソード君が配置されていません。");
assert(stages[0].objects.some((object) => object.type === "doorClosed"), "閉じた扉が配置されていません。");

const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browserPath = browserCandidates.find(existsSync);

if (!browserPath || typeof WebSocket === "undefined") {
  console.log("Static smoke test passed. Browser smoke test skipped (Chrome/Edge or WebSocket unavailable). ");
  process.exit(0);
}

const port = await new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.on("error", rejectPort);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolvePort(address.port));
  });
});

const profileDirectory = mkdtempSync(join(tmpdir(), "asiris-prototype-smoke-"));
const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], { stdio: "ignore" });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function findPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((entry) => entry.type === "page");
      if (page) return page;
    } catch {
      // デバッグポートの起動を待ちます。
    }
    await delay(100);
  }
  throw new Error("テスト用ブラウザへ接続できませんでした。");
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

let nextMessageId = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    browserErrors.push(message.params.args.map((argument) => argument.value ?? argument.description).join(" "));
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    browserErrors.push(message.params.entry.text);
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextMessageId;
  const response = new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return response;
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(expression, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(message);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });

  const landingUrl = pathToFileURL(resolve(root, "index.html")).href;
  await send("Page.navigate", { url: landingUrl });
  await waitFor(`document.readyState === "complete" && Boolean(document.querySelector("#teach-button"))`, "最新UIを読み込めませんでした。");
  await evaluate(`document.querySelector("#teach-button").click()`);
  assert(await evaluate(`!document.querySelector("#teach-modal").hidden`), "最新UIの回答モーダルを開けませんでした。");

  const pageUrl = pathToFileURL(resolve(root, "game.html")).href;
  await send("Page.navigate", { url: pageUrl });
  await waitFor(
    `Boolean(globalThis.ASIRIS_PROTOTYPE?.getSnapshot().tileSheetReady)`,
    "ゲームまたはcolored.pngの読込が完了しませんでした。",
  );

  const initial = await evaluate(`(() => {
    const canvas = document.querySelector("#game-canvas");
    const bounds = canvas.getBoundingClientRect();
    const snapshot = ASIRIS_PROTOTYPE.getSnapshot();
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: bounds.width,
      viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      paletteCount: document.querySelectorAll(".palette-button").length,
      player: snapshot.player,
      sword: snapshot.sword,
    };
  })()`);
  assert(initial.width === 192 && initial.height === 192, "実ブラウザのCanvasが192×192ではありません。");
  assert(initial.cssWidth <= initial.viewportWidth, "スマートフォン幅でCanvasが横にはみ出しています。");
  assert(initial.pageWidth <= initial.viewportWidth, "スマートフォン幅でページが横にはみ出しています。");
  assert(initial.paletteCount === 15, `パレット項目数が想定外です: ${initial.paletteCount}`);

  if (process.env.PROTOTYPE_SCREENSHOT) {
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(process.env.PROTOTYPE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  await evaluate(`document.querySelector('[data-direction="right"]').click()`);
  const moved = await evaluate(`ASIRIS_PROTOTYPE.getSnapshot()`);
  assert(moved.player.x === 2 && moved.player.y === 1, "右へ1マス移動できませんでした。");
  assert(moved.sword.x === 1 && moved.sword.y === 1, "ソード君が直前の主人公位置へ追従していません。");

  await evaluate(`document.querySelector("#reset-button").click()`);
  await delay(100);
  await evaluate(`document.querySelector('[data-direction="left"]').click()`);
  const blocked = await evaluate(`ASIRIS_PROTOTYPE.getSnapshot().player`);
  assert(blocked.x === 1 && blocked.y === 1, "外周壁を通過できてしまいます。");

  await evaluate(`document.querySelector("#action-button").click()`);
  const actionLog = await evaluate(`document.querySelector("#game-log-text").textContent`);
  assert(actionLog === "何もない", `空セルの調査ログが不正です: ${actionLog}`);

  const warpBounds = await evaluate(`(() => {
    document.querySelector("#warp-button").click();
    const bounds = document.querySelector("#game-canvas").getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  })()`);
  const warpX = warpBounds.left + (10.5 / 12) * warpBounds.width;
  const warpY = warpBounds.top + (4.5 / 12) * warpBounds.height;
  await evaluate(`document.querySelector("#game-canvas").dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true,
    pointerId: 7,
    clientX: ${warpX},
    clientY: ${warpY},
  }))`);
  assert(await evaluate(`ASIRIS_PROTOTYPE.getSnapshot().player.x === 10 && ASIRIS_PROTOTYPE.getSnapshot().player.y === 4`), "デバッグワープが動作しませんでした。");
  await delay(100);
  await evaluate(`document.querySelector('[data-direction="down"]').click()`);
  const doorBlocked = await evaluate(`ASIRIS_PROTOTYPE.getSnapshot().player`);
  assert(doorBlocked.x === 10 && doorBlocked.y === 4, "閉じた扉を通過できてしまいます。");
  await evaluate(`document.querySelector("#action-button").click()`);
  assert(await evaluate(`document.querySelector("#game-log-text").textContent === "扉は閉じている"`), "閉じた扉の調査ログが不正です。");
  await evaluate(`document.querySelector("#reset-button").click()`);

  await evaluate(`document.querySelector("#edit-button").click(); document.querySelector('[data-tool="wall"]').click()`);
  const canvasBounds = await evaluate(`(() => {
    const bounds = document.querySelector("#game-canvas").getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  })()`);
  const paintX = canvasBounds.left + (5.5 / 12) * canvasBounds.width;
  const paintY = canvasBounds.top + (5.5 / 12) * canvasBounds.height;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: paintX, y: paintY, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: paintX, y: paintY, button: "left", clickCount: 1 });
  await delay(180);
  const edited = await evaluate(`(() => {
    const snapshot = ASIRIS_PROTOTYPE.getSnapshot();
    return {
      mode: snapshot.mode,
      tile: snapshot.stage.tiles[5][5],
      stored: Boolean(localStorage.getItem("asiris-stage-editor-v2")),
      panelVisible: !document.querySelector("#editor-panel").hidden,
    };
  })()`);
  assert(edited.mode === "edit" && edited.panelVisible, "編集モードへ切り替わっていません。");
  assert(edited.tile === 2, "Canvasクリックで壁を配置できませんでした。");
  assert(edited.stored, "編集内容がlocalStorageへ保存されていません。");

  await evaluate(`document.querySelector("#test-play-button").click()`);
  assert(await evaluate(`ASIRIS_PROTOTYPE.getSnapshot().mode === "play"`), "編集直後にテストプレイへ移れませんでした。");

  await send("Emulation.setDeviceMetricsOverride", {
    width: 1024,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`window.dispatchEvent(new Event("resize"))`);
  await delay(50);
  const desktopLayout = await evaluate(`(() => ({
    canvasWidth: document.querySelector("#game-canvas").getBoundingClientRect().width,
    viewportWidth: innerWidth,
    pageWidth: document.documentElement.scrollWidth,
  }))()`);
  assert(desktopLayout.canvasWidth === 576, `PC幅でCanvasが3倍表示ではありません: ${desktopLayout.canvasWidth}`);
  assert(desktopLayout.pageWidth <= desktopLayout.viewportWidth, "PC幅でページが横にはみ出しています。");

  await send("Page.navigate", { url: `${pageUrl}?atlas=1` });
  await waitFor(`document.querySelectorAll(".atlas-item").length === 1078`, "素材一覧1078件が表示されませんでした。");
  const atlas = await evaluate(`({
    count: document.querySelectorAll(".atlas-item").length,
    catalogCount: document.querySelectorAll(".atlas-item.is-catalog").length,
    gameHidden: document.querySelector("#game-app").hidden,
  })`);
  assert(atlas.count === 1078, "atlasのフレーム数が1078ではありません。");
  assert(atlas.catalogCount === 14, "TILE_CATALOG登録素材の印が不足しています。");
  assert(atlas.gameHidden, "atlas表示時に通常ゲームが隠れていません。");
  assert(browserErrors.length === 0, `ブラウザエラーが発生しました:\n${browserErrors.join("\n")}`);

  console.log("Prototype smoke test passed: game, controls, editor, storage, and 1078-frame atlas.");
} finally {
  let didExit = false;
  const browserExited = new Promise((resolveExit) => browser.once("exit", () => {
    didExit = true;
    resolveExit();
  }));
  socket.send(JSON.stringify({ id: ++nextMessageId, method: "Browser.close" }));
  await Promise.race([browserExited, delay(3000)]);
  socket.close();
  if (!didExit) {
    browser.kill();
    await Promise.race([browserExited, delay(2000)]);
  }
  try {
    rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch {
    // WindowsでChromeの一時ファイル解放が遅い場合も、テスト結果自体は維持します。
  }
}
