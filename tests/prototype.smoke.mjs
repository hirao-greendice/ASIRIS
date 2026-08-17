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
    const boardObjects = [...document.querySelectorAll('[data-board-part="true"]')];
    return {
      cells: document.querySelectorAll(".board-cell").length,
      stageId: stage.dataset.stageId,
      ratio: bounds.width / bounds.height,
      allObjectsInside: boardObjects.every((object) => {
        const box = object.getBoundingClientRect();
        return box.left >= bounds.left - 1 && box.top >= bounds.top - 1
          && box.right <= bounds.right + 1 && box.bottom <= bounds.bottom + 1;
      }),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight,
    };
  })()`);

  assert(initial.cells === 12 * 21, `セル数が${initial.cells}です。`);
  assert(initial.stageId === "knowledge-01", "初期ステージが正しくありません。");
  assert(Math.abs(initial.ratio - 12 / 21) < 0.002, `盤面比率が${initial.ratio}です。`);
  assert(initial.allObjectsInside, "盤面外にはみ出しているオブジェクトがあります。");
  assert(!initial.horizontalOverflow && !initial.verticalOverflow, "ページに不要なスクロールがあります。");

  const result = await evaluate(`(() => {
    const click = (action) => document.querySelector('[data-action="' + action + '"]').click();
    click("move-right");
    click("move-right");
    click("move-right");
    const playerAfterMove = document.querySelector("#player").dataset.x;
    click("interact");
    const knowledgeRemoved = !document.querySelector('[data-object-id="knowledge-01"]');
    const unlockMessage = document.querySelector("#stage-status").textContent;
    click("next-stage");
    return {
      playerAfterMove,
      knowledgeRemoved,
      unlockMessage,
      stageAfterUnlock: document.querySelector("#stage").dataset.stageId,
    };
  })()`);

  assert(result.playerAfterMove === "6", "右移動が正しく反映されません。");
  assert(result.knowledgeRemoved, "知識を取得できません。");
  assert(result.unlockMessage.includes("ステージ2"), "解放メッセージが表示されません。");
  assert(result.stageAfterUnlock === "knowledge-02", "解放後にステージ2へ切り替えられません。");

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
