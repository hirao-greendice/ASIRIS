import "./styles.css";
import "./editor/editor.css";
import portTownBgmUrl from "./assets/audio/mirishira-port-town-bgm.mp3";
import { StageEditor } from "./editor/StageEditor";
import {
  loadStageDraft,
  toStageDefinition,
  validateStageDraft,
} from "./editor/stageDraft";
import { loadGameAssets } from "./game/assets/GameAssets";
import { BackgroundMusic } from "./game/audio/BackgroundMusic";
import { Game } from "./game/core/Game";
import { InputController } from "./game/core/InputController";
import type { StageDefinition } from "./game/core/stageTypes";
import { prototypeStage } from "./game/data/prototypeStage";
import { stage01 } from "./game/data/stage01";

const searchParams = new URLSearchParams(window.location.search);
const editorMode = searchParams.get("editor") === "1";
const playtestMode = searchParams.get("playtest") === "1";
const gameShell = document.querySelector<HTMLElement>("#game-shell");
const editorRoot = document.querySelector<HTMLElement>("#editor-root");

if (!gameShell || !editorRoot) {
  throw new Error("Application root was not found.");
}

let cleanup = (): void => undefined;

if (editorMode) {
  gameShell.hidden = true;
  editorRoot.hidden = false;
  document.body.classList.add("editor-mode");
  document.title = "ステージエディター — ミリしらソード";

  const editor = new StageEditor(editorRoot, stage01);
  cleanup = () => {
    editor.destroy();
    document.body.classList.remove("editor-mode");
  };
} else {
  const stage = getGameStage(playtestMode);
  cleanup = await startGame(stage, playtestMode);
}

if (import.meta.hot) {
  import.meta.hot.dispose(cleanup);
}

function getGameStage(isPlaytest: boolean): StageDefinition {
  if (!isPlaytest) return prototypeStage;

  const draft = loadStageDraft();
  if (!draft) {
    throw new Error("プレイテスト用のステージ下書きがありません。");
  }

  const errors = validateStageDraft(draft);
  if (errors.length > 0) {
    throw new Error(
      `ステージ下書きをプレイできません: ${errors.join(" / ")}`,
    );
  }

  return toStageDefinition(draft);
}

async function startGame(
  stage: StageDefinition,
  isPlaytest: boolean,
): Promise<() => void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
  const controlButtons =
    document.querySelectorAll<HTMLButtonElement>("[data-control]");
  const editorLink =
    document.querySelector<HTMLAnchorElement>("[data-editor-link]");
  const stageLabel =
    document.querySelector<HTMLElement>("[data-stage-label]");
  const goalLabel =
    document.querySelector<HTMLElement>("[data-goal-label]");

  if (!canvas || !stageLabel || !goalLabel) {
    throw new Error("Game canvas or HUD was not found.");
  }

  if (editorLink && isPlaytest) {
    editorLink.textContent = "BACK TO EDITOR";
    editorLink.href = "?editor=1";
  }

  const backgroundMusic = new BackgroundMusic(portTownBgmUrl, 0.3);
  backgroundMusic.start();
  const input = new InputController(controlButtons);
  const assets = await loadGameAssets();
  const game = new Game(canvas, input, stage, assets, {
    stageLabel,
    goalLabel,
  });
  const focusCanvas = (): void => canvas.focus();
  canvas.addEventListener("pointerdown", focusCanvas);

  return () => {
    canvas.removeEventListener("pointerdown", focusCanvas);
    game.destroy();
    input.destroy();
    backgroundMusic.destroy();
  };
}
