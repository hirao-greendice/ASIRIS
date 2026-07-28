import type {
  GameAssets,
  HeroDirection,
} from "../assets/GameAssets";
import { CameraController } from "./CameraController";
import type {
  GameControl,
  InputController,
} from "./InputController";
import {
  isWalkable,
  type GridPoint,
  type StageDefinition,
  type TileKind,
} from "./stageTypes";

const MOVEMENT_TIMING = {
  stepSeconds: 0.13,
  holdDelaySeconds: 0.22,
  repeatIntervalSeconds: 0.15,
} as const;
const WALL_WIDTH_IN_TILES = 1;
const WALL_HEIGHT_IN_TILES = 88 / 64;
const HERO_SIZE_IN_TILES = 1.25;
const HERO_ATTACK_SIZE_IN_TILES = HERO_SIZE_IN_TILES * (512 / 384);
const HERO_ATTACK_ORIGIN_Y = 448 / 512;
const ATTACK_POSE_SECONDS = 0.18;

const MOVEMENT: Record<HeroDirection, GridPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

interface MoveAnimation {
  from: GridPoint;
  to: GridPoint;
  elapsed: number;
}

interface SceneDrawable {
  kind: "wall" | "player";
  x: number;
  y: number;
  depth: number;
}

export class Game {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly camera: CameraController;
  private readonly playerTile: GridPoint;
  private readonly playerDrawPosition: GridPoint;
  private moveAnimation: MoveAnimation | null = null;
  private repeatDirection: HeroDirection | null = null;
  private repeatCountdown = 0;
  private facing: HeroDirection = "down";
  private primaryPulse = 0;
  private secondaryPulse = 0;
  private animationFrame = 0;
  private previousTime = performance.now();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: InputController,
    private readonly stage: StageDefinition,
    private readonly assets: GameAssets,
  ) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }

    this.context = context;
    this.playerTile = { ...stage.playerStart };
    this.playerDrawPosition = { ...stage.playerStart };
    this.camera = new CameraController(stage, this.playerTile);
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
    this.primaryPulse = Math.max(0, this.primaryPulse - deltaSeconds);
    this.secondaryPulse = Math.max(0, this.secondaryPulse - deltaSeconds);

    if (this.moveAnimation) {
      this.updateMoveAnimation(deltaSeconds);
    }

    this.updateRepeatTimer(deltaSeconds);

    if (!this.moveAnimation) {
      const control = this.input.consumeNextPress();
      if (control) {
        this.handleControl(control);
      } else {
        this.tryRepeatMove();
      }
    }

    this.camera.update(this.playerTile, deltaSeconds);
    this.canvas.dataset.playerTile =
      `${this.playerTile.x},${this.playerTile.y}`;
    this.canvas.dataset.cameraArea = this.camera.areaId;
    this.canvas.dataset.playerFacing = this.facing;
  }

  private handleControl(control: GameControl): void {
    if (isHeroDirection(control)) {
      this.facing = control;
      this.repeatDirection = control;
      this.repeatCountdown = MOVEMENT_TIMING.holdDelaySeconds;
      this.startMove(control);
      return;
    }

    if (control === "primary") this.primaryPulse = ATTACK_POSE_SECONDS;
    if (control === "secondary") this.secondaryPulse = 0.18;
  }

  private startMove(direction: HeroDirection): void {
    const movement = MOVEMENT[direction];
    const destination = {
      x: this.playerTile.x + movement.x,
      y: this.playerTile.y + movement.y,
    };

    if (!isWalkable(this.stage, destination)) return;

    this.moveAnimation = {
      from: { ...this.playerDrawPosition },
      to: destination,
      elapsed: 0,
    };
    Object.assign(this.playerTile, destination);
  }

  private updateRepeatTimer(deltaSeconds: number): void {
    if (
      !this.repeatDirection ||
      !this.input.isPressed(this.repeatDirection)
    ) {
      this.repeatDirection = null;
      this.repeatCountdown = 0;
      return;
    }

    this.repeatCountdown -= deltaSeconds;
  }

  private tryRepeatMove(): void {
    if (!this.repeatDirection || this.repeatCountdown > 0) return;

    this.facing = this.repeatDirection;
    this.startMove(this.repeatDirection);
    this.repeatCountdown = MOVEMENT_TIMING.repeatIntervalSeconds;
  }

  private updateMoveAnimation(deltaSeconds: number): void {
    if (!this.moveAnimation) return;

    this.moveAnimation.elapsed += deltaSeconds;
    const progress = Math.min(
      this.moveAnimation.elapsed / MOVEMENT_TIMING.stepSeconds,
      1,
    );
    const eased = 1 - (1 - progress) ** 3;

    this.playerDrawPosition.x =
      this.moveAnimation.from.x +
      (this.moveAnimation.to.x - this.moveAnimation.from.x) * eased;
    this.playerDrawPosition.y =
      this.moveAnimation.from.y +
      (this.moveAnimation.to.y - this.moveAnimation.from.y) * eased;

    if (progress === 1) {
      Object.assign(this.playerDrawPosition, this.moveAnimation.to);
      this.moveAnimation = null;
    }
  }

  private draw(): void {
    const view = this.camera.view;
    const scaleX = this.canvas.width / view.width;
    const scaleY = this.canvas.height / view.height;

    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.fillStyle = "#171513";
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(
      scaleX,
      0,
      0,
      scaleY,
      -view.x * scaleX,
      -view.y * scaleY,
    );
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";

    this.drawGroundTiles(view);
    this.drawSceneObjects(view);
  }

  private drawGroundTiles(view: Readonly<GridPoint & {
    width: number;
    height: number;
  }>): void {
    const startX = Math.max(0, Math.floor(view.x));
    const startY = Math.max(0, Math.floor(view.y));
    const endX = Math.min(this.stage.width, Math.ceil(view.x + view.width));
    const endY = Math.min(this.stage.height, Math.ceil(view.y + view.height));

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        this.drawGroundTile(this.stage.tiles[y][x], x, y);
      }
    }
  }

  private drawGroundTile(tile: TileKind, x: number, y: number): void {
    const isAlternate = (x + y) % 2 === 0;
    const colors: Record<Exclude<TileKind, "wall">, string> = {
      floor: isAlternate ? "#bba0bd" : "#b69ab8",
      grass: isAlternate ? "#87936f" : "#818d69",
    };

    const groundTile = tile === "wall" ? "floor" : tile;
    this.context.fillStyle = colors[groundTile];
    this.context.fillRect(x, y, 1, 1);
    this.context.strokeStyle = "rgba(23, 21, 19, 0.12)";
    this.context.lineWidth = 0.018;
    this.context.strokeRect(x, y, 1, 1);
  }

  private drawSceneObjects(view: Readonly<GridPoint & {
    width: number;
    height: number;
  }>): void {
    const drawables: SceneDrawable[] = [];
    const startX = Math.max(0, Math.floor(view.x) - 1);
    const startY = Math.max(0, Math.floor(view.y) - 1);
    const endX = Math.min(
      this.stage.width,
      Math.ceil(view.x + view.width) + 1,
    );
    const endY = Math.min(
      this.stage.height,
      Math.ceil(view.y + view.height) + 1,
    );

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        if (this.stage.tiles[y][x] === "wall") {
          drawables.push({ kind: "wall", x, y, depth: y + 1 });
        }
      }
    }

    drawables.push({
      kind: "player",
      x: this.playerDrawPosition.x,
      y: this.playerDrawPosition.y,
      depth: this.playerDrawPosition.y + 1,
    });

    drawables.sort((first, second) =>
      first.depth === second.depth
        ? first.x - second.x
        : first.depth - second.depth,
    );

    for (const drawable of drawables) {
      if (drawable.kind === "wall") {
        this.drawWall(drawable.x, drawable.y);
      } else {
        this.drawPlayer();
      }
    }
  }

  private drawWall(tileX: number, tileY: number): void {
    const centerX = tileX + 0.5;
    const bottomY = tileY + 1;

    this.context.drawImage(
      this.assets.wallLow,
      centerX - WALL_WIDTH_IN_TILES / 2,
      bottomY - WALL_HEIGHT_IN_TILES,
      WALL_WIDTH_IN_TILES,
      WALL_HEIGHT_IN_TILES,
    );
  }

  private drawPlayer(): void {
    const x = this.playerDrawPosition.x + 0.5;
    const bottomY = this.playerDrawPosition.y + 1;
    const isAttacking = this.primaryPulse > 0;

    if (this.secondaryPulse > 0) {
      this.context.strokeStyle = "rgba(31, 28, 30, 0.72)";
      this.context.lineWidth = 0.055;
      this.context.beginPath();
      this.context.ellipse(
        x,
        bottomY - 0.06,
        0.38,
        0.14,
        0,
        0,
        Math.PI * 2,
      );
      this.context.stroke();
    }

    if (isAttacking) {
      this.context.drawImage(
        this.assets.hero.attack[this.facing],
        x - HERO_ATTACK_SIZE_IN_TILES / 2,
        bottomY - HERO_ATTACK_SIZE_IN_TILES * HERO_ATTACK_ORIGIN_Y,
        HERO_ATTACK_SIZE_IN_TILES,
        HERO_ATTACK_SIZE_IN_TILES,
      );
    } else {
      this.context.drawImage(
        this.assets.hero.idle[this.facing],
        x - HERO_SIZE_IN_TILES / 2,
        bottomY - HERO_SIZE_IN_TILES,
        HERO_SIZE_IN_TILES,
        HERO_SIZE_IN_TILES,
      );
    }

    this.canvas.dataset.playerPose = isAttacking ? "attack" : "idle";
  }
}

function isHeroDirection(control: GameControl): control is HeroDirection {
  return control in MOVEMENT;
}
