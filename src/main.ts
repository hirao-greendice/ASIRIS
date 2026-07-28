import "./styles.css";
import { GamePreview } from "./game/core/GamePreview";
import { InputController } from "./game/core/InputController";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const controlButtons =
  document.querySelectorAll<HTMLButtonElement>("[data-control]");

if (!canvas) {
  throw new Error("Game canvas was not found.");
}

const input = new InputController(controlButtons);
const game = new GamePreview(canvas, input);

canvas.addEventListener("pointerdown", () => canvas.focus());

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy();
    input.destroy();
  });
}
