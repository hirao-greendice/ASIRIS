import "./styles.css";
import { loadGameAssets } from "./game/assets/GameAssets";
import { Game } from "./game/core/Game";
import { InputController } from "./game/core/InputController";
import { stage01 } from "./game/data/stage01";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const controlButtons =
  document.querySelectorAll<HTMLButtonElement>("[data-control]");

if (!canvas) {
  throw new Error("Game canvas was not found.");
}

const input = new InputController(controlButtons);
const assets = await loadGameAssets();
const game = new Game(canvas, input, stage01, assets);

canvas.addEventListener("pointerdown", () => canvas.focus());

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy();
    input.destroy();
  });
}
