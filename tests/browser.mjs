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
const outputDirectory = await mkdtemp(join(tmpdir(), "mirishira-browser-"));

const directions = (action, count) =>
  Array.from({ length: count }, () => action);

const solutions = [
  ["slash-jp", "right", "right", ...directions("down", 4)],
  [
    "slash-jp",
    ...directions("right", 5),
    ...directions("left", 3),
    "up",
    "up",
    "left",
    "left",
  ],
  [
    "slash-jp",
    "right",
    "down",
    "left",
    "left",
    "right",
    "right",
    "down",
    "down",
  ],
  ["slash-en", "down", "down", ...directions("right", 6)],
  [
    "slash-en",
    "right",
    ...directions("down", 4),
    "right",
    "down",
    "down",
  ],
  [
    "slash-en",
    "up",
    ...directions("right", 3),
    "down",
    "up",
    ...directions("left", 3),
    ...directions("down", 2),
    ...directions("right", 3),
    ...directions("left", 3),
    ...directions("up", 4),
    ...directions("right", 3),
    "down",
    "slash-en",
    ...directions("right", 4),
  ],
  ["left", "up", "slash-en", ...directions("right", 4)],
  [
    "slash-en",
    "left",
    "right",
    ...directions("slash-jp", 6),
    "left",
    "down",
    "down",
  ],
  [
    "slash-en",
    "reset",
    "left",
    "up",
    "slash-en",
    "left",
    "left",
    ...directions("up", 5),
    "right",
  ],
  [
    "left",
    "up",
    "slash-jp",
    "left",
    "up",
    "right",
    "right",
    "down",
    "right",
    "up",
    "up",
    "right",
    "right",
    "down",
    "slash-jp",
    "right",
    "down",
    "left",
    "left",
    "down",
    "left",
    "up",
    "up",
    "down",
    "down",
    "right",
    "right",
    "right",
  ],
];

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
  const browserErrors = [];
  desktop.on("pageerror", (error) => browserErrors.push(error.message));
  desktop.on("response", (response) => {
    if (response.status() >= 400) {
      browserErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await desktop.goto(baseUrl, { waitUntil: "networkidle" });
  await desktop.waitForFunction(() => window.__MIRISHIRA_DEBUG__);

  await desktop.keyboard.press("j");
  await desktop.waitForTimeout(80);
  let snapshot = await desktop.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.match(snapshot.letters, /ヘ@3,2\|ビ@3,3/);
  await desktop.screenshot({
    path: join(outputDirectory, "desktop-stage1.png"),
    fullPage: true,
  });
  await desktop.keyboard.press("r");
  await desktop.waitForTimeout(120);
  await desktop.keyboard.press("k");
  await desktop.waitForTimeout(80);
  snapshot = await desktop.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.equal(snapshot.letters, "");
  assert.equal(snapshot.turn, 1);
  await desktop.keyboard.press("r");
  await desktop.waitForTimeout(100);
  await desktop.keyboard.press("ArrowRight");
  await desktop.waitForTimeout(80);
  snapshot = await desktop.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.equal(snapshot.player, "4,1");
  await desktop.keyboard.press("r");
  await desktop.waitForTimeout(100);

  for (let index = 0; index < solutions.length; index += 1) {
    snapshot = await desktop.evaluate(() =>
      window.__MIRISHIRA_DEBUG__.snapshot()
    );
    assert.equal(snapshot.stage, index + 1);
    for (const action of solutions[index]) {
      await desktop.evaluate((nextAction) => {
        window.__MIRISHIRA_DEBUG__.dispatch(nextAction);
      }, action);
    }

    if (index < solutions.length - 1) {
      try {
        await desktop.waitForFunction(
          (expectedStage) =>
            window.__MIRISHIRA_DEBUG__.snapshot().stage === expectedStage,
          index + 2,
          { timeout: 2500 },
        );
      } catch (error) {
        const stalled = await desktop.evaluate(() =>
          window.__MIRISHIRA_DEBUG__.snapshot()
        );
        throw new Error(
          `Browser solution stalled after stage ${index + 1}: ` +
            JSON.stringify(stalled),
          { cause: error },
        );
      }
    } else {
      await desktop.waitForFunction(
        () => window.__MIRISHIRA_DEBUG__.snapshot().clear === true,
        undefined,
        { timeout: 2500 },
      );
    }
  }

  snapshot = await desktop.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.equal(snapshot.clear, true);
  assert.deepEqual(browserErrors, []);
  await desktop.screenshot({
    path: join(outputDirectory, "desktop-clear.png"),
    fullPage: true,
  });
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const mobile = await mobileContext.newPage();
  const mobileErrors = [];
  mobile.on("pageerror", (error) => mobileErrors.push(error.message));
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.waitForFunction(() => window.__MIRISHIRA_DEBUG__);

  const layout = await mobile.evaluate(() => {
    const jp = document.querySelector('[data-control="slash-jp"]');
    const en = document.querySelector('[data-control="slash-en"]');
    const up = document.querySelector('[data-control="up"]');
    const canvas = document.querySelector("#game-canvas");
    const rect = (element) => element.getBoundingClientRect();
    return {
      innerHeight: window.innerHeight,
      bodyHeight: document.body.scrollHeight,
      documentHeight: document.documentElement.scrollHeight,
      jp: rect(jp),
      en: rect(en),
      up: rect(up),
      canvas: rect(canvas),
    };
  });
  assert.ok(layout.bodyHeight <= layout.innerHeight + 1);
  assert.ok(layout.documentHeight <= layout.innerHeight + 1);
  assert.ok(layout.jp.width >= 68 && layout.jp.height >= 68);
  assert.ok(layout.en.width >= 68 && layout.en.height >= 68);
  assert.ok(layout.up.width >= 54 && layout.up.height >= 54);
  assert.ok(layout.canvas.width <= 390 && layout.canvas.height <= 390);

  await mobile.locator('[data-control="slash-jp"]').tap();
  await mobile.waitForTimeout(100);
  snapshot = await mobile.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.match(snapshot.letters, /ヘ@3,2\|ビ@3,3/);
  await mobile.locator('[data-control="reset"]').tap();
  await mobile.waitForTimeout(100);
  snapshot = await mobile.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.equal(snapshot.letters, "");
  await mobile.locator('[data-control="slash-en"]').tap();
  await mobile.waitForTimeout(100);
  snapshot = await mobile.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.equal(snapshot.letters, "");
  assert.equal(snapshot.turn, 1);
  await mobile.locator('[data-control="reset"]').tap();
  await mobile.waitForTimeout(100);
  await mobile.locator('[data-control="right"]').tap();
  await mobile.waitForTimeout(100);
  snapshot = await mobile.evaluate(() =>
    window.__MIRISHIRA_DEBUG__.snapshot()
  );
  assert.equal(snapshot.player, "4,1");
  await mobile.locator('[data-control="reset"]').tap();
  await mobile.waitForTimeout(100);
  assert.deepEqual(mobileErrors, []);

  await mobile.screenshot({
    path: join(outputDirectory, "mobile-stage1.png"),
    fullPage: true,
  });

  await mobile.setViewportSize({ width: 320, height: 568 });
  await mobile.waitForTimeout(100);
  const compactLayout = await mobile.evaluate(() => {
    const bounds = (selector) =>
      document.querySelector(selector).getBoundingClientRect();
    return {
      innerHeight: window.innerHeight,
      bodyHeight: document.body.scrollHeight,
      documentHeight: document.documentElement.scrollHeight,
      jp: bounds('[data-control="slash-jp"]'),
      en: bounds('[data-control="slash-en"]'),
      up: bounds('[data-control="up"]'),
      canvas: bounds("#game-canvas"),
    };
  });
  assert.ok(compactLayout.bodyHeight <= compactLayout.innerHeight + 1);
  assert.ok(compactLayout.documentHeight <= compactLayout.innerHeight + 1);
  assert.ok(compactLayout.jp.width >= 68 && compactLayout.jp.height >= 68);
  assert.ok(compactLayout.en.width >= 68 && compactLayout.en.height >= 68);
  assert.ok(compactLayout.up.width >= 54 && compactLayout.up.height >= 54);
  await mobile.screenshot({
    path: join(outputDirectory, "mobile-compact-stage1.png"),
    fullPage: true,
  });
  await mobileContext.close();

  process.stdout.write(
    JSON.stringify(
      {
        result: "passed",
        desktopClear: true,
        mobileLayout: layout,
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
