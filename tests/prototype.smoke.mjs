import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const gameUrl = pathToFileURL(resolve(currentDirectory, "..", "index.html")).href;
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const chromePath = chromeCandidates.find(existsSync);

if (!chromePath) {
  throw new Error("Chrome または Edge が見つかりませんでした。");
}

const profileDirectory = mkdtempSync(join(tmpdir(), "kirimoji-smoke-"));
const debuggingPort = 9333;
const browser = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${profileDirectory}`,
  gameUrl,
], { stdio: "ignore" });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function findPage() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((entry) => entry.type === "page" && entry.url.startsWith("file:"));
      if (page) return page;
    } catch {
      // Chrome のデバッグポートが開くまで待つ。
    }
    await delay(100);
  }
  throw new Error("ブラウザの起動を確認できませんでした。");
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

let messageId = 0;
const pendingMessages = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pendingMessages.has(message.id)) return;
  const { resolveMessage, rejectMessage } = pendingMessages.get(message.id);
  pendingMessages.delete(message.id);
  if (message.error) rejectMessage(new Error(message.error.message));
  else resolveMessage(message.result);
});

function send(method, params = {}) {
  messageId += 1;
  const id = messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveMessage, rejectMessage) => {
    pendingMessages.set(id, { resolveMessage, rejectMessage });
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function move(...directions) {
  for (const direction of directions) {
    await evaluate(`movePlayer(${JSON.stringify(direction)})`);
  }
}

async function solve(answer) {
  await evaluate("pressB()");
  for (const letter of [...answer]) {
    await evaluate(`addAnswerLetter(${JSON.stringify(letter)})`);
  }
  await evaluate("submitAnswer()");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await evaluate("document.readyState");

  await move("left", "left");
  await solve("かさ");
  assert(await evaluate("document.querySelector('[data-object-id=tree]').classList.contains('cuttable')"), "木が切断可能になりませんでした。");
  await evaluate("pressB()");
  await delay(900);
  assert(await evaluate("[...document.querySelectorAll('#inventory .letter-chip')].map((node) => node.textContent).join('')") === "かさき", "木から「き」を取得できませんでした。");
  assert(await evaluate("document.querySelector('.hero').style.top") === "87.5%", "木の文字で勇者が1マス押されませんでした。");

  await move("up", "right", "right", "right", "up");
  await solve("かき");
  await evaluate("pressB()");
  await delay(1150);
  assert(await evaluate("[...document.querySelectorAll('#inventory .letter-chip')].map((node) => node.textContent).join('')") === "かさきいし", "石から「い」「し」を取得できませんでした。");
  const heroLeftAfterStone = await evaluate("parseFloat(document.querySelector('.hero').style.left)");
  assert(Math.abs(heroLeftAfterStone - ((2 / 7) * 100)) < 0.01, "石の2文字で勇者が2マス押されませんでした。");

  await move("right", "right", "right", "up", "up");
  await solve("いし");
  await evaluate("pressB()");
  await delay(900);
  assert(await evaluate("[...document.querySelectorAll('#inventory .letter-chip')].map((node) => node.textContent).join('')") === "かさきいしぎ", "鍵から「ぎ」を取得できませんでした。");

  await move("up", "up", "up", "left", "left");
  await solve("かぎ");
  await delay(450);
  assert(await evaluate("document.querySelector('#clear-screen').classList.contains('open')"), "扉の正解後にCLEARになりませんでした。");

  console.log("PASS: 木 → 石 → 鍵 → 扉、文字獲得、1/2マス押し出し、CLEARを確認");
} finally {
  socket.close();
  browser.kill();
  await delay(500);
  try {
    rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows では Chrome の子プロセスがプロファイルを一瞬保持する場合がある。
  }
}
