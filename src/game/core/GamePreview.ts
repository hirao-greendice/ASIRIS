import type { InputController } from "./InputController";

const WORLD_SIZE = 1000;
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 360;

interface Player {
  x: number;
  y: number;
}

export class GamePreview {
  private readonly context: CanvasRenderingContext2D;
  private readonly player: Player = {
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
  };
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private previousTime = performance.now();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: InputController,
  ) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }

    this.context = context;
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    this.resize();
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
  }

  private resize = (): void => {
    const size = Math.max(1, Math.round(this.canvas.clientWidth));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = size * pixelRatio;
    this.canvas.height = size * pixelRatio;
  };

  private loop = (time: number): void => {
    const deltaSeconds = Math.min((time - this.previousTime) / 1000, 0.05);
    this.previousTime = time;
    this.update(deltaSeconds);
    this.draw();
    this.animationFrame = requestAnimationFrame(this.loop);
  };

  private update(deltaSeconds: number): void {
    const horizontal =
      Number(this.input.isPressed("right")) - Number(this.input.isPressed("left"));
    const vertical =
      Number(this.input.isPressed("down")) - Number(this.input.isPressed("up"));

    if (horizontal === 0 && vertical === 0) return;

    const length = Math.hypot(horizontal, vertical) || 1;
    this.player.x += (horizontal / length) * PLAYER_SPEED * deltaSeconds;
    this.player.y += (vertical / length) * PLAYER_SPEED * deltaSeconds;

    const margin = PLAYER_SIZE / 2;
    this.player.x = Math.min(WORLD_SIZE - margin, Math.max(margin, this.player.x));
    this.player.y = Math.min(WORLD_SIZE - margin, Math.max(margin, this.player.y));
  }

  private draw(): void {
    const scale = this.canvas.width / WORLD_SIZE;

    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    this.context.fillStyle = "#bba0bd";
    this.context.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

    this.context.strokeStyle = "rgba(31, 28, 30, 0.08)";
    this.context.lineWidth = 1 / scale;
    const gridSize = WORLD_SIZE / 8;
    for (let line = gridSize; line < WORLD_SIZE; line += gridSize) {
      this.context.beginPath();
      this.context.moveTo(line, 0);
      this.context.lineTo(line, WORLD_SIZE);
      this.context.moveTo(0, line);
      this.context.lineTo(WORLD_SIZE, line);
      this.context.stroke();
    }

    const primaryPressed = this.input.isPressed("primary");
    const secondaryPressed = this.input.isPressed("secondary");

    if (primaryPressed) {
      this.context.beginPath();
      this.context.arc(this.player.x, this.player.y, 60, 0, Math.PI * 2);
      this.context.strokeStyle = "rgba(246, 242, 235, 0.72)";
      this.context.lineWidth = 8;
      this.context.stroke();
    }

    this.context.save();
    this.context.translate(this.player.x, this.player.y);
    if (secondaryPressed) {
      this.context.rotate(Math.PI / 4);
    }
    this.context.fillStyle = "#f6f2eb";
    this.context.fillRect(
      -PLAYER_SIZE / 2,
      -PLAYER_SIZE / 2,
      PLAYER_SIZE,
      PLAYER_SIZE,
    );
    this.context.restore();
  }
}
