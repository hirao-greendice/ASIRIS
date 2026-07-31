import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const browserCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chromePath = browserCandidates.find((candidate) =>
  existsSync(candidate)
);
if (!chromePath) {
  throw new Error(
    "Chrome/Edge was not found. Set CHROME_PATH before running browser tests.",
  );
}

const host = "127.0.0.1";
const port = 4179;
const baseUrl = `http://${host}:${port}/`;
const outputDirectory = await mkdtemp(
  join(tmpdir(), "mirishira-browser-"),
);

const setupActions = [
  "up",
  "up",
  "down",
  "down",
  "right",
  "right",
  "right",
  "down",
];
const exitActions = [
  "right",
  "down",
  "down",
  "down",
  "right",
  "right",
  "right",
];
const solution = [...setupActions, "slash-en", ...exitActions];
const japaneseAttempt = [...setupActions, "slash-jp", ...exitActions];
const slimeSolution = [
  "slash-jp",
  "up",
  "right",
  "down",
  "up",
  "right",
  "down",
  "right",
  "up",
  "right",
  "down",
  "down",
  "right",
  "right",
  "down",
  "right",
];

const keyboardKeys = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  "slash-jp": "j",
  "slash-en": "k",
};

const server = await createServer({
  server: { host, port, strictPort: true },
  logLevel: "error",
});
await server.listen();

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const desktop = await desktopContext.newPage();
  const desktopErrors = collectBrowserErrors(desktop);
  await desktop.goto(baseUrl, { waitUntil: "networkidle" });
  await desktop.waitForFunction(() => window.__MIRISHIRA_DEBUG__);

  const desktopHud = await desktop.evaluate(() => ({
    stage: document.querySelector("[data-stage-label]")?.textContent,
    target: document.querySelector("[data-sword-label]")?.textContent,
    turn: document.querySelector("[data-turn-label]")?.textContent,
    selectedStage: document.querySelector("[data-stage-select]")?.value,
    stageOptions:
      document.querySelector("[data-stage-select]")?.options.length,
    canvas: document
      .querySelector("#game-canvas")
      ?.getBoundingClientRect().toJSON(),
  }));
  assert.match(desktopHud.stage, /ROOM 1 \/ 14/);
  assert.match(desktopHud.target, /対象：—/);
  assert.equal(desktopHud.turn, "TURN 0");
  assert.equal(desktopHud.selectedStage, "0");
  assert.equal(desktopHud.stageOptions, 14);
  assert.ok(desktopHud.canvas.width >= 700);
  assert.equal(desktopHud.canvas.width, desktopHud.canvas.height);
  await desktop.screenshot({
    path: join(outputDirectory, "desktop-tree-illustration.png"),
    fullPage: true,
  });

  let state;
  await desktop.locator("[data-stage-select]").selectOption("13");
  await desktop.waitForTimeout(100);
  state = await snapshot(desktop);
  assert.equal(state.stage, 14);
  assert.equal(state.stageId, "meeting-knight-rampart");
  assert.match(
    await desktop.locator("[data-sword-label]").textContent(),
    /対象：きし \/ KNIGHT/,
  );

  for (let index = 0; index < solution.length; index += 1) {
    await desktop.keyboard.press(keyboardKeys[solution[index]]);
    await desktop.waitForTimeout(75);
    if (index === 8) {
      const cut = await snapshot(desktop);
      assert.equal(
        cut.letters,
        "K@7,8|N@7,9|I@7,10|G@7,11|H@7,12|T@7,13",
      );
      assert.equal(cut.doors.split("|")[0], "open");
      assert.equal(cut.turn, 9);
    }
  }
  await desktop.waitForFunction(
    () => window.__MIRISHIRA_DEBUG__.snapshot().clear === true,
    undefined,
    { timeout: 2500 },
  );
  state = await snapshot(desktop);
  assert.equal(state.clear, true);
  assert.equal(state.turn, 16);
  await desktop.screenshot({
    path: join(outputDirectory, "desktop-clear.png"),
    fullPage: true,
  });

  await desktop.keyboard.press("r");
  await desktop.waitForTimeout(100);
  state = await snapshot(desktop);
  assert.equal(state.player, "4,6");
  assert.equal(state.turn, 0);
  assert.equal(state.letters, "");
  assert.equal(state.doors.split("|")[0], "closed");
  assert.equal(state.clear, false);

  await performKeyboardActions(desktop, japaneseAttempt);
  await desktop.waitForTimeout(700);
  state = await snapshot(desktop);
  assert.equal(state.status, "failed");
  assert.equal(state.failureReason, "sight");
  await desktop.screenshot({
    path: join(outputDirectory, "desktop-sight-failure.png"),
    fullPage: true,
  });
  await desktop.keyboard.press("r");
  await desktop.waitForTimeout(100);
  assert.equal((await snapshot(desktop)).status, "playing");

  await desktop.locator("[data-stage-select]").selectOption("3");
  await desktop.waitForTimeout(100);
  state = await snapshot(desktop);
  assert.equal(state.stage, 4);
  assert.equal(state.stageId, "slime-buddha");
  assert.equal(state.player, "1,2");
  assert.equal(state.turn, 0);
  await desktop.screenshot({
    path: join(outputDirectory, "desktop-slime-illustration.png"),
    fullPage: true,
  });
  await performKeyboardActions(desktop, slimeSolution);
  state = await snapshot(desktop);
  assert.equal(state.turn, slimeSolution.length);
  assert.equal(state.letters, "す@2,3|ら@3,3|仏@5,4");
  assert.equal(state.doors.split("|")[0], "open");
  await desktop.screenshot({
    path: join(outputDirectory, "desktop-slime-buddha.png"),
    fullPage: true,
  });
  await desktop.locator("[data-stage-select]").selectOption("13");
  await desktop.waitForTimeout(100);
  state = await snapshot(desktop);
  assert.equal(state.stageId, "meeting-knight-rampart");
  assert.equal(state.turn, 0);
  assert.deepEqual(desktopErrors, []);
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const mobile = await mobileContext.newPage();
  const mobileErrors = collectBrowserErrors(mobile);
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.waitForFunction(() => window.__MIRISHIRA_DEBUG__);

  const mobileLayout = await getMobileLayout(mobile);
  assert.ok(mobileLayout.bodyHeight <= mobileLayout.innerHeight + 1);
  assert.ok(mobileLayout.documentHeight <= mobileLayout.innerHeight + 1);
  assert.ok(mobileLayout.jp.width >= 68 && mobileLayout.jp.height >= 68);
  assert.ok(mobileLayout.en.width >= 68 && mobileLayout.en.height >= 68);
  assert.ok(mobileLayout.up.width >= 54 && mobileLayout.up.height >= 54);
  assert.ok(
    mobileLayout.stageSelect.width >= 120 &&
      mobileLayout.stageSelect.height >= 30,
  );
  assert.ok(mobileLayout.canvas.width <= 390);
  assert.equal(mobileLayout.canvas.width, mobileLayout.canvas.height);

  await mobile.locator("[data-stage-select]").selectOption("13");
  await mobile.waitForTimeout(100);

  for (let index = 0; index < solution.length; index += 1) {
    await mobile
      .locator(`[data-control="${solution[index]}"]`)
      .tap();
    await mobile.waitForTimeout(75);
    if (index === 8) {
      const cut = await snapshot(mobile);
      assert.equal(
        cut.letters,
        "K@7,8|N@7,9|I@7,10|G@7,11|H@7,12|T@7,13",
      );
      assert.equal(cut.doors.split("|")[0], "open");
    }
  }
  await mobile.waitForFunction(
    () => window.__MIRISHIRA_DEBUG__.snapshot().clear === true,
    undefined,
    { timeout: 2500 },
  );
  assert.equal((await snapshot(mobile)).turn, 16);
  await mobile.screenshot({
    path: join(outputDirectory, "mobile-clear.png"),
    fullPage: true,
  });

  await mobile.locator('[data-control="reset"]').tap();
  await mobile.waitForTimeout(100);
  state = await snapshot(mobile);
  assert.equal(state.player, "4,6");
  assert.equal(state.turn, 0);
  assert.equal(state.clear, false);
  await mobile.locator("[data-stage-select]").selectOption("0");
  await mobile.waitForTimeout(100);
  assert.equal((await snapshot(mobile)).stageId, "tree-single-letter");
  await mobile.locator("[data-stage-select]").selectOption("13");
  await mobile.waitForTimeout(100);
  assert.equal(
    (await snapshot(mobile)).stageId,
    "meeting-knight-rampart",
  );

  await mobile.setViewportSize({ width: 320, height: 568 });
  await mobile.waitForTimeout(100);
  const compactLayout = await getMobileLayout(mobile);
  assert.ok(compactLayout.bodyHeight <= compactLayout.innerHeight + 1);
  assert.ok(
    compactLayout.documentHeight <= compactLayout.innerHeight + 1,
  );
  assert.ok(compactLayout.jp.width >= 68 && compactLayout.jp.height >= 68);
  assert.ok(compactLayout.en.width >= 68 && compactLayout.en.height >= 68);
  assert.ok(compactLayout.up.width >= 54 && compactLayout.up.height >= 54);
  assert.ok(
    compactLayout.stageSelect.width >= 120 &&
      compactLayout.stageSelect.height >= 30,
  );
  assert.deepEqual(mobileErrors, []);
  await mobile.screenshot({
    path: join(outputDirectory, "mobile-compact.png"),
    fullPage: true,
  });
  await mobileContext.close();

  process.stdout.write(
    JSON.stringify(
      {
        result: "passed",
        desktopClear: true,
        mobileClear: true,
        mobileLayout,
        compactLayout,
        screenshots: outputDirectory,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  await server.close();
}

async function performKeyboardActions(page, actions) {
  for (const action of actions) {
    await page.keyboard.press(keyboardKeys[action]);
    await page.waitForTimeout(75);
  }
}

async function snapshot(page) {
  return page.evaluate(() => window.__MIRISHIRA_DEBUG__.snapshot());
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

async function getMobileLayout(page) {
  return page.evaluate(() => {
    const bounds = (selector) =>
      document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      innerHeight: window.innerHeight,
      bodyHeight: document.body.scrollHeight,
      documentHeight: document.documentElement.scrollHeight,
      jp: bounds('[data-control="slash-jp"]'),
      en: bounds('[data-control="slash-en"]'),
      up: bounds('[data-control="up"]'),
      stageSelect: bounds("[data-stage-select]"),
      canvas: bounds("#game-canvas"),
    };
  });
}
