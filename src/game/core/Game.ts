import type {
  GameAssets,
  HeroDirection,
} from "../assets/GameAssets";
import { SoundEffects } from "../audio/SoundEffects";
import { CameraController } from "./CameraController";
import type {
  GameControl,
  InputController,
} from "./InputController";
import {
  type GridPoint,
  type StageDefinition,
  type TileKind,
} from "./stageTypes";
import {
  WorldState,
  type LetterState,
  type NamedObjectState,
  type PushedLetter,
  type PuzzleState,
} from "./WorldState";

const MOVEMENT_TIMING = {
  stepSeconds: 0.27,
  holdDelaySeconds: 0.27,
  repeatIntervalSeconds: 0.27,
} as const;
const WALL_WIDTH_IN_TILES = 1;
const WALL_HEIGHT_IN_TILES = 88 / 64;
const HERO_SIZE_IN_TILES = 1.25;
const HERO_ATTACK_SIZE_IN_TILES = HERO_SIZE_IN_TILES * (512 / 384);
const HERO_ATTACK_ORIGIN_Y = 448 / 512;
const ATTACK_POSE_SECONDS = 0.18;
const LETTER_SPAWN_SECONDS = 0.32;
const LETTER_FUSION_SECONDS = 0.34;
const ANSWER_REVEAL_SECONDS = 1.18;
const STAGE_BANNER_SECONDS = 1.1;

const MOVEMENT: Record<HeroDirection, GridPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface GameHud {
  stageLabel: HTMLElement;
  goalLabel: HTMLElement;
  swordLabel: HTMLElement;
}

interface MoveAnimation {
  from: GridPoint;
  to: GridPoint;
  elapsed: number;
  pushedLetters?: readonly PushedLetter[];
  advancesStage?: boolean;
}

type SceneDrawable =
  | {
      kind: "wall";
      x: number;
      y: number;
      depth: number;
    }
  | {
      kind: "door";
      x: number;
      y: number;
      depth: number;
    }
  | {
      kind: "object";
      object: NamedObjectState;
      x: number;
      y: number;
      depth: number;
    }
  | {
      kind: "letter";
      letter: LetterState;
      x: number;
      y: number;
      depth: number;
    }
  | {
      kind: "player";
      x: number;
      y: number;
      depth: number;
    };

export class Game {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly playerDrawPosition: GridPoint;
  private readonly soundEffects = new SoundEffects();
  private readonly world: WorldState;
  private camera: CameraController;
  private moveAnimation: MoveAnimation | null = null;
  private repeatDirection: HeroDirection | null = null;
  private repeatCountdown = 0;
  private primaryPulse = 0;
  private stageBannerRemaining = STAGE_BANNER_SECONDS;
  private animationFrame = 0;
  private previousTime = performance.now();
  private visualTime = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: InputController,
    private readonly stage: StageDefinition,
    private readonly assets: GameAssets,
    private readonly hud?: GameHud,
  ) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }

    this.context = context;
    this.world = new WorldState(stage);
    const start = this.world.playerTile;
    this.playerDrawPosition = { ...start };
    this.camera = new CameraController(stage, this.world.playerTile);
    this.canvas.dataset.stageSize = `${stage.width}x${stage.height}`;
    this.canvas.dataset.roomCount = String(stage.rooms.length);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    this.resize();
    this.syncHud();
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.soundEffects.destroy();
  }

  private get activePuzzle(): PuzzleState | undefined {
    return this.world.activePuzzle;
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
    this.visualTime += deltaSeconds;
    this.primaryPulse = Math.max(0, this.primaryPulse - deltaSeconds);
    this.stageBannerRemaining = Math.max(
      0,
      this.stageBannerRemaining - deltaSeconds,
    );
    const worldUpdate = this.world.update(deltaSeconds);
    if (worldUpdate.puzzleSolved) {
      this.soundEffects.solve();
      this.syncHud();
    }

    if (this.moveAnimation) {
      this.updateMoveAnimation(deltaSeconds);
    }

    this.updateHeldDirection(deltaSeconds);

    if (!this.moveAnimation) {
      const control = this.input.consumeNextPress();
      if (control) {
        this.handleControl(control);
      } else if (!this.world.isPrototypeClear) {
        this.tryHeldMove();
      }
    }

    this.camera.update(this.world.playerTile, deltaSeconds);
    this.updateDebugData();
  }

  private handleControl(control: GameControl): void {
    if (control === "reset") {
      this.resetPuzzle();
      return;
    }
    if (this.world.isPrototypeClear) return;

    if (isHeroDirection(control)) {
      this.world.facing = control;
      this.repeatDirection = control;
      this.repeatCountdown = MOVEMENT_TIMING.holdDelaySeconds;
      this.startMove(control);
      return;
    }

    if (control === "primary") {
      this.attack();
      return;
    }

    if (control === "slash-jp" || control === "slash-en") {
      const nextMode = control === "slash-jp" ? "kana" : "english";
      if (this.world.swordMode !== nextMode) {
        this.world.toggleSwordMode();
      }
      this.attack();
      this.syncHud();
      return;
    }

    if (control === "switch") {
      this.world.toggleSwordMode();
      this.soundEffects.changeSword();
      this.syncHud();
    }
  }

  private attack(): void {
    this.primaryPulse = ATTACK_POSE_SECONDS;
    this.soundEffects.slash();
    const result = this.world.attack();
    if (result.cutName) {
      this.canvas.dataset.lastCutName = result.cutName;
    }
    if (result.blockedName) {
      this.canvas.dataset.blockedCutName = result.blockedName;
    }
  }

  private startMove(direction: HeroDirection): void {
    const result = this.world.tryMove(direction);
    if (!result.moved) return;
    if (result.fusedResult) this.soundEffects.fuse();
    this.beginPlayerMove(result.destination, {
      pushedLetters: result.pushedLetters,
      advancesStage: result.advancesStage,
    });
  }

  private beginPlayerMove(
    destination: GridPoint,
    details: Pick<
      MoveAnimation,
      "pushedLetters" | "advancesStage"
    > = {},
  ): void {
    this.moveAnimation = {
      from: { ...this.playerDrawPosition },
      to: destination,
      elapsed: 0,
      ...details,
    };
  }

  private updateHeldDirection(deltaSeconds: number): void {
    const preferredDirection = this.input.getPreferredDirection();
    if (!preferredDirection || this.world.isPrototypeClear) {
      this.repeatDirection = null;
      this.repeatCountdown = 0;
      return;
    }

    if (preferredDirection !== this.repeatDirection) {
      this.repeatDirection = preferredDirection;
      this.repeatCountdown = 0;
      return;
    }

    this.repeatCountdown -= deltaSeconds;
  }

  private tryHeldMove(): void {
    if (!this.repeatDirection || this.repeatCountdown > 0) return;

    this.world.facing = this.repeatDirection;
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
    this.playerDrawPosition.x =
      this.moveAnimation.from.x +
      (this.moveAnimation.to.x - this.moveAnimation.from.x) * progress;
    this.playerDrawPosition.y =
      this.moveAnimation.from.y +
      (this.moveAnimation.to.y - this.moveAnimation.from.y) * progress;

    if (progress === 1) {
      const shouldAdvance = this.moveAnimation.advancesStage === true;
      Object.assign(this.playerDrawPosition, this.moveAnimation.to);
      this.moveAnimation = null;
      if (shouldAdvance) this.advanceStage();
    }
  }

  private advanceStage(): void {
    this.soundEffects.door();
    const result = this.world.advanceStage();
    if (result === "clear") {
      this.repeatDirection = null;
      this.input.clearPendingPresses();
      this.syncHud();
      return;
    }

    Object.assign(this.playerDrawPosition, this.world.playerTile);
    this.stageBannerRemaining = STAGE_BANNER_SECONDS;
    this.repeatDirection = null;
    this.repeatCountdown = MOVEMENT_TIMING.holdDelaySeconds;
    this.input.clearPendingPresses();
    this.syncHud();
  }

  private resetPuzzle(): void {
    this.soundEffects.reset();
    this.input.clearPendingPresses();
    this.moveAnimation = null;
    this.primaryPulse = 0;
    this.repeatDirection = null;
    this.repeatCountdown = MOVEMENT_TIMING.holdDelaySeconds;

    const wasClear = this.world.isPrototypeClear;
    this.world.reset();
    if (wasClear) {
      this.camera = new CameraController(this.stage, this.stage.playerStart);
    }

    Object.assign(this.playerDrawPosition, this.world.playerTile);
    this.stageBannerRemaining = STAGE_BANNER_SECONDS;
    this.syncHud();
  }

  private syncHud(): void {
    if (!this.hud) return;

    const isEnglish = this.world.swordMode === "english";
    this.hud.swordLabel.textContent = isEnglish
      ? "剣：ENGLISH"
      : "剣：かな";
    this.hud.swordLabel.dataset.mode = this.world.swordMode;

    if (this.world.isPrototypeClear) {
      this.hud.stageLabel.textContent = "COMPLETE";
      this.hud.goalLabel.textContent = "試作クリア";
      return;
    }

    const puzzle = this.activePuzzle;
    if (!puzzle) {
      this.hud.stageLabel.textContent = "PLAYTEST";
      this.hud.goalLabel.textContent = this.stage.name;
      return;
    }

    this.hud.stageLabel.textContent =
      `STAGE ${puzzle.definition.number} / ${this.world.puzzleCount}` +
      `　「${puzzle.definition.title}」`;
    this.hud.goalLabel.textContent = puzzle.isSolved
      ? "扉が開いた。右の扉へ進む"
      : puzzle.definition.hint;
  }

  private updateDebugData(): void {
    this.canvas.dataset.playerTile =
      `${this.world.playerTile.x},${this.world.playerTile.y}`;
    this.canvas.dataset.cameraArea = this.camera.areaId;
    this.canvas.dataset.cameraView = formatCameraView(this.camera.view);
    this.canvas.dataset.playerFacing = this.world.facing;
    this.canvas.dataset.playerDrawPosition =
      `${this.playerDrawPosition.x.toFixed(3)},` +
      `${this.playerDrawPosition.y.toFixed(3)}`;
    this.canvas.dataset.inputDirection =
      this.input.getPreferredDirection() ?? "";
    this.canvas.dataset.puzzle =
      this.activePuzzle?.definition.id ?? "none";
    this.canvas.dataset.puzzleSolved =
      String(this.activePuzzle?.isSolved ?? false);
    this.canvas.dataset.prototypeClear =
      String(this.world.isPrototypeClear);
    this.canvas.dataset.swordMode = this.world.swordMode;
    this.canvas.dataset.letters =
      this.activePuzzle?.letters
        .map((letter) => letter.character)
        .join("|") ?? "";
  }

  private draw(): void {
    const view = this.camera.view;
    const scaleX = this.canvas.width / view.width;
    const scaleY = this.canvas.height / view.height;

    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.fillStyle = "#0d0b10";
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
    this.drawPuzzleGround();
    this.drawSceneObjects(view);
    this.drawScreenOverlay();
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
      floor: isAlternate ? "#1e1a22" : "#221d26",
      grass: isAlternate ? "#283027" : "#242c23",
    };

    const groundTile = tile === "wall" ? "floor" : tile;
    this.context.fillStyle = colors[groundTile];
    this.context.fillRect(x, y, 1, 1);
    this.context.strokeStyle = "rgba(199, 165, 204, 0.055)";
    this.context.lineWidth = 0.016;
    this.context.strokeRect(x, y, 1, 1);
  }

  private drawPuzzleGround(): void {
    const puzzle = this.activePuzzle;
    if (!puzzle) return;

    const goal = puzzle.definition.goal;
    const completedLetter = puzzle.letters.find(
      (letter) =>
        letter.isFixed &&
        pointsEqual(letter.position, goal.position),
    );
    const { x, y } = goal.position;

    this.context.save();
    if (completedLetter) {
      const glow = 0.08 + (Math.sin(this.visualTime * 5) + 1) * 0.035;
      this.context.fillStyle = `rgba(199, 165, 204, ${glow})`;
      this.context.fillRect(x + 0.08, y + 0.08, 0.84, 0.84);
    }
    this.context.setLineDash([0.13, 0.09]);
    this.context.strokeStyle = completedLetter
      ? "rgba(226, 205, 231, 0.82)"
      : "rgba(199, 165, 204, 0.72)";
    this.context.lineWidth = 0.045;
    this.context.strokeRect(x + 0.11, y + 0.11, 0.78, 0.78);
    this.context.setLineDash([]);
    if (!completedLetter) {
      this.context.fillStyle = "rgba(233, 220, 236, 0.2)";
      this.context.font =
        `${getLetterFontSize(goal.result) * 0.92}px ` +
        '"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText(goal.result, x + 0.5, y + 0.53);
    }
    this.context.fillStyle = "rgba(199, 165, 204, 0.58)";
    this.context.font = "0.22px sans-serif";
    this.context.textAlign = "right";
    this.context.fillText("圧着 →", x - 0.06, y + 0.52);
    this.context.restore();
  }

  private drawSceneObjects(view: Readonly<GridPoint & {
    width: number;
    height: number;
  }>): void {
    const drawables: SceneDrawable[] = [];
    const puzzle = this.activePuzzle;
    const activeDoor = puzzle?.definition.door.position;
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
        if (
          this.stage.tiles[y][x] === "wall" &&
          (!activeDoor || !pointsEqual(activeDoor, { x, y }))
        ) {
          drawables.push({ kind: "wall", x, y, depth: y + 1 });
        }
      }
    }

    if (puzzle) {
      drawables.push({
        kind: "door",
        x: puzzle.definition.door.position.x,
        y: puzzle.definition.door.position.y,
        depth: puzzle.definition.door.position.y + 1,
      });
      for (const object of puzzle.objects) {
        if (object.isCut) continue;
        drawables.push({
          kind: "object",
          object,
          x: object.definition.position.x,
          y: object.definition.position.y,
          depth: object.definition.position.y + 1,
        });
      }
      for (const letter of puzzle.letters) {
        const drawPosition = this.getLetterDrawPosition(letter);
        drawables.push({
          kind: "letter",
          letter,
          x: drawPosition.x,
          y: drawPosition.y,
          depth: drawPosition.y + 1,
        });
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
        : first.depth - second.depth
    );

    for (const drawable of drawables) {
      if (drawable.kind === "wall") {
        this.drawWall(drawable.x, drawable.y);
      } else if (drawable.kind === "door") {
        this.drawDoor(drawable.x, drawable.y, puzzle?.isSolved ?? false);
      } else if (drawable.kind === "object") {
        this.drawNamedObject(drawable.object);
      } else if (drawable.kind === "letter") {
        this.drawLetter(drawable.letter, drawable.x, drawable.y);
      } else {
        this.drawPlayer();
      }
    }
  }

  private getLetterDrawPosition(letter: LetterState): GridPoint {
    if (!letter.hasLanded) {
      const progress = easeOutCubic(
        letter.spawnElapsed / LETTER_SPAWN_SECONDS,
      );
      return {
        x:
          letter.spawnFrom.x +
          (letter.position.x - letter.spawnFrom.x) * progress,
        y:
          letter.spawnFrom.y +
          (letter.position.y - letter.spawnFrom.y) * progress -
          Math.sin(progress * Math.PI) * 0.52,
      };
    }

    const pushedLetter = this.moveAnimation?.pushedLetters?.find(
      (candidate) => candidate.id === letter.id,
    );
    if (pushedLetter) {
      const progress = Math.min(
        (this.moveAnimation?.elapsed ?? 0) /
          MOVEMENT_TIMING.stepSeconds,
        1,
      );
      return {
        x:
          pushedLetter.from.x +
          (letter.position.x - pushedLetter.from.x) *
            progress,
        y:
          pushedLetter.from.y +
          (letter.position.y - pushedLetter.from.y) *
            progress,
      };
    }

    return letter.position;
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

  private drawDoor(tileX: number, tileY: number, isOpen: boolean): void {
    this.context.save();
    this.context.fillStyle = "#09070b";
    this.context.fillRect(tileX + 0.08, tileY + 0.02, 0.84, 0.98);
    this.context.strokeStyle = "#c7a5cc";
    this.context.lineWidth = 0.055;
    this.context.strokeRect(tileX + 0.08, tileY + 0.02, 0.84, 0.98);

    if (isOpen) {
      const pulse = 0.15 + (Math.sin(this.visualTime * 4) + 1) * 0.06;
      this.context.fillStyle = `rgba(199, 165, 204, ${pulse})`;
      this.context.fillRect(tileX + 0.18, tileY + 0.1, 0.64, 0.82);
      this.context.fillStyle = "#f1e9f3";
      this.context.font = "0.34px sans-serif";
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText("→", tileX + 0.5, tileY + 0.52);
    } else {
      this.context.fillStyle = "#4b414f";
      this.context.fillRect(tileX + 0.17, tileY + 0.09, 0.66, 0.86);
      this.context.strokeStyle = "rgba(15, 12, 17, 0.45)";
      this.context.lineWidth = 0.025;
      for (let x = tileX + 0.33; x < tileX + 0.8; x += 0.17) {
        this.context.beginPath();
        this.context.moveTo(x, tileY + 0.1);
        this.context.lineTo(x, tileY + 0.94);
        this.context.stroke();
      }
      this.context.fillStyle = "#c7a5cc";
      this.context.beginPath();
      this.context.arc(tileX + 0.5, tileY + 0.53, 0.075, 0, Math.PI * 2);
      this.context.fill();
    }
    this.context.restore();
  }

  private drawNamedObject(object: NamedObjectState): void {
    const { position, kind } = object.definition;
    const name = this.world.getObjectName(object.definition);
    const x = position.x;
    const y = position.y;

    this.context.save();
    this.context.fillStyle = "rgba(0, 0, 0, 0.34)";
    this.context.beginPath();
    this.context.ellipse(
      x + 0.5,
      y + 0.83,
      0.38,
      0.13,
      0,
      0,
      Math.PI * 2,
    );
    this.context.fill();

    if (kind === "tree") {
      this.context.fillStyle = "#765b46";
      this.context.fillRect(x + 0.43, y + 0.42, 0.14, 0.39);
      this.context.fillStyle = "#596b56";
      this.context.beginPath();
      this.context.arc(x + 0.5, y + 0.38, 0.34, 0, Math.PI * 2);
      this.context.fill();
      this.context.fillStyle = "#71816b";
      this.context.beginPath();
      this.context.arc(x + 0.37, y + 0.3, 0.2, 0, Math.PI * 2);
      this.context.fill();
    } else if (kind === "sun") {
      this.context.strokeStyle = "#e5bb62";
      this.context.lineWidth = 0.05;
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4;
        this.context.beginPath();
        this.context.moveTo(
          x + 0.5 + Math.cos(angle) * 0.3,
          y + 0.52 + Math.sin(angle) * 0.3,
        );
        this.context.lineTo(
          x + 0.5 + Math.cos(angle) * 0.42,
          y + 0.52 + Math.sin(angle) * 0.42,
        );
        this.context.stroke();
      }
      this.context.fillStyle = "#ddb45b";
      this.context.beginPath();
      this.context.arc(x + 0.5, y + 0.52, 0.25, 0, Math.PI * 2);
      this.context.fill();
    } else if (kind === "moon") {
      this.context.fillStyle = "#d8d1bd";
      this.context.beginPath();
      this.context.arc(x + 0.48, y + 0.5, 0.32, 0, Math.PI * 2);
      this.context.fill();
      this.context.fillStyle = "#29232d";
      this.context.beginPath();
      this.context.arc(x + 0.61, y + 0.4, 0.3, 0, Math.PI * 2);
      this.context.fill();
    } else if (kind === "slime") {
      this.context.fillStyle = "#8e75a3";
      this.context.beginPath();
      this.context.moveTo(x + 0.19, y + 0.72);
      this.context.quadraticCurveTo(x + 0.2, y + 0.28, x + 0.5, y + 0.25);
      this.context.quadraticCurveTo(x + 0.8, y + 0.28, x + 0.81, y + 0.72);
      this.context.quadraticCurveTo(x + 0.5, y + 0.92, x + 0.19, y + 0.72);
      this.context.fill();
      this.context.fillStyle = "#201a25";
      this.context.beginPath();
      this.context.arc(x + 0.4, y + 0.56, 0.035, 0, Math.PI * 2);
      this.context.arc(x + 0.6, y + 0.56, 0.035, 0, Math.PI * 2);
      this.context.fill();
    } else {
      this.context.fillStyle = "#ded7df";
      this.context.fillRect(x + 0.2, y + 0.25, 0.6, 0.52);
      this.context.fillStyle = "#8e75a3";
      this.context.fillRect(x + 0.2, y + 0.25, 0.6, 0.14);
      this.context.fillStyle = "#4b414f";
      for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          this.context.fillRect(
            x + 0.29 + column * 0.17,
            y + 0.47 + row * 0.15,
            0.07,
            0.06,
          );
        }
      }
    }

    this.context.fillStyle = "rgba(10, 8, 12, 0.88)";
    this.context.fillRect(x + 0.06, y + 0.01, 0.88, 0.29);
    this.context.strokeStyle = "rgba(199, 165, 204, 0.72)";
    this.context.lineWidth = 0.025;
    this.context.strokeRect(x + 0.06, y + 0.01, 0.88, 0.29);
    this.context.fillStyle = "#f7f1f8";
    this.context.font =
      `${getObjectNameFontSize(name)}px "Yu Gothic", sans-serif`;
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";
    this.context.fillText(name, x + 0.5, y + 0.16);
    this.context.restore();
  }

  private drawLetter(letter: LetterState, tileX: number, tileY: number): void {
    const spawnProgress = letter.hasLanded
      ? 1
      : easeOutCubic(letter.spawnElapsed / LETTER_SPAWN_SECONDS);
    const fusionProgress =
      letter.fusionElapsed === null
        ? 1
        : Math.min(letter.fusionElapsed / LETTER_FUSION_SECONDS, 1);
    const fusionScale =
      letter.fusionElapsed === null
        ? 1
        : 0.7 +
          fusionProgress * 0.3 +
          Math.sin(fusionProgress * Math.PI) * 0.18;
    const size =
      0.82 * (0.55 + spawnProgress * 0.45) * fusionScale;
    const x = tileX + 0.5 - size / 2;
    const y = tileY + 0.5 - size / 2;

    this.context.save();
    if (letter.isFixed) {
      const glow = 0.3 + (Math.sin(this.visualTime * 5) + 1) * 0.12;
      this.context.shadowColor = `rgba(222, 196, 228, ${glow})`;
      this.context.shadowBlur = 0.24;
    }
    this.context.fillStyle = letter.isFixed ? "#e8d9eb" : "#d4bdd8";
    this.context.strokeStyle = letter.isFixed ? "#fff7ff" : "#f0e3f2";
    this.context.lineWidth = 0.04;
    this.context.beginPath();
    this.context.roundRect(x, y, size, size, 0.12);
    this.context.fill();
    this.context.stroke();
    this.context.shadowBlur = 0;

    if (letter.fusionElapsed !== null && fusionProgress < 1) {
      this.context.strokeStyle =
        `rgba(245, 232, 247, ${1 - fusionProgress})`;
      this.context.lineWidth = 0.055;
      this.context.beginPath();
      this.context.arc(
        tileX + 0.5,
        tileY + 0.5,
        0.48 + fusionProgress * 0.28,
        0,
        Math.PI * 2,
      );
      this.context.stroke();
    }
    this.drawLetterGlyph(
      letter.character,
      tileX,
      tileY,
      1,
      fusionScale,
    );
    this.context.restore();
  }

  private drawLetterGlyph(
    character: string,
    tileX: number,
    tileY: number,
    opacity: number,
    scale: number,
  ): void {
    this.context.save();
    this.context.globalAlpha *= opacity;
    this.context.translate(tileX + 0.5, tileY + 0.53);
    this.context.scale(scale, scale);
    this.context.fillStyle = "#1a151d";
    this.context.font =
      `700 ${getLetterFontSize(character)}px ` +
      '"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";
    this.context.fillText(character, 0, 0);
    this.context.restore();
  }

  private drawPlayer(): void {
    const x = this.playerDrawPosition.x + 0.5;
    const bottomY = this.playerDrawPosition.y + 1;
    const isAttacking = this.primaryPulse > 0;

    if (isAttacking) {
      this.context.drawImage(
        this.assets.hero.attack[this.world.facing],
        x - HERO_ATTACK_SIZE_IN_TILES / 2,
        bottomY - HERO_ATTACK_SIZE_IN_TILES * HERO_ATTACK_ORIGIN_Y,
        HERO_ATTACK_SIZE_IN_TILES,
        HERO_ATTACK_SIZE_IN_TILES,
      );
      this.drawSlashArc(x, bottomY - 0.5);
    } else {
      this.context.drawImage(
        this.assets.hero.idle[this.world.facing],
        x - HERO_SIZE_IN_TILES / 2,
        bottomY - HERO_SIZE_IN_TILES,
        HERO_SIZE_IN_TILES,
        HERO_SIZE_IN_TILES,
      );
    }

    this.canvas.dataset.playerPose = isAttacking ? "attack" : "idle";
  }

  private drawSlashArc(x: number, y: number): void {
    const angles: Record<HeroDirection, number> = {
      right: 0,
      down: Math.PI / 2,
      left: Math.PI,
      up: -Math.PI / 2,
    };
    const angle = angles[this.world.facing];
    const movement = MOVEMENT[this.world.facing];
    this.context.save();
    this.context.strokeStyle =
      this.world.swordMode === "english"
        ? "rgba(174, 222, 226, 0.88)"
        : "rgba(244, 232, 247, 0.82)";
    this.context.lineWidth = 0.07;
    this.context.beginPath();
    this.context.arc(
      x + movement.x * 0.45,
      y + movement.y * 0.45,
      0.48,
      angle - 0.72,
      angle + 0.72,
    );
    this.context.stroke();
    this.context.restore();
  }

  private drawScreenOverlay(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.context.setTransform(1, 0, 0, 1, 0, 0);

    if (this.stageBannerRemaining > 0 && this.activePuzzle) {
      const alpha = Math.min(1, this.stageBannerRemaining * 2.5);
      this.context.fillStyle = `rgba(10, 8, 12, ${0.68 * alpha})`;
      this.context.fillRect(0, height * 0.055, width, height * 0.105);
      this.context.fillStyle = `rgba(245, 236, 247, ${alpha})`;
      this.context.font =
        `600 ${Math.round(width * 0.036)}px ` +
        '"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText(
        `STAGE ${this.activePuzzle.definition.number}　` +
          `「${this.activePuzzle.definition.title}」`,
        width / 2,
        height * 0.108,
      );
    }

    const puzzle = this.activePuzzle;
    if (
      puzzle?.isSolved &&
      puzzle.solvedElapsed < ANSWER_REVEAL_SECONDS &&
      !this.world.isPrototypeClear
    ) {
      const appear = Math.min(1, puzzle.solvedElapsed / 0.18);
      const disappear = Math.min(
        1,
        (ANSWER_REVEAL_SECONDS - puzzle.solvedElapsed) / 0.22,
      );
      const alpha = Math.max(0, Math.min(appear, disappear));
      const scale = 0.82 + appear * 0.18;
      this.context.fillStyle = `rgba(8, 6, 10, ${0.46 * alpha})`;
      this.context.fillRect(0, 0, width, height);
      this.context.save();
      this.context.translate(width / 2, height / 2);
      this.context.scale(scale, scale);
      this.context.fillStyle = `rgba(245, 235, 247, ${alpha})`;
      this.context.shadowColor = "#c7a5cc";
      this.context.shadowBlur = width * 0.045;
      this.context.font =
        `700 ${Math.round(
          width * getAnswerFontRatio(puzzle.definition.answer),
        )}px ` +
        '"Yu Mincho", "Hiragino Mincho ProN", serif';
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText(puzzle.definition.answer, 0, 0);
      this.context.restore();
    }

    if (this.world.isPrototypeClear) {
      this.context.fillStyle = "rgba(8, 6, 10, 0.88)";
      this.context.fillRect(0, 0, width, height);
      this.context.fillStyle = "#f4ebf5";
      this.context.font =
        `700 ${Math.round(width * 0.09)}px ` +
        '"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText("試作クリア", width / 2, height * 0.44);
      this.context.fillStyle = "#c7a5cc";
      this.context.font =
        `500 ${Math.round(width * 0.032)}px ` +
        '"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
      this.context.fillText(
        "4つのことばを圧着しました",
        width / 2,
        height * 0.55,
      );
      this.context.fillStyle = "rgba(244, 235, 245, 0.62)";
      this.context.font =
        `400 ${Math.round(width * 0.024)}px ` +
        '"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
      this.context.fillText(
        "Rキー / リセットで最初から",
        width / 2,
        height * 0.63,
      );
    }
  }
}

function isHeroDirection(control: GameControl): control is HeroDirection {
  return control in MOVEMENT;
}

function pointsEqual(first: GridPoint, second: GridPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function getObjectNameFontSize(name: string): number {
  const length = Array.from(name).length;
  if (length <= 2) return 0.25;
  if (length <= 4) return 0.2;
  return 0.16;
}

function getLetterFontSize(character: string): number {
  const length = Array.from(character).length;
  if (length === 1) return 0.52;
  if (length <= 4) return 0.25;
  if (length <= 6) return 0.17;
  return 0.14;
}

function getAnswerFontRatio(answer: string): number {
  const length = Array.from(answer).length;
  if (length === 1) return 0.27;
  if (length <= 4) return 0.15;
  return 0.1;
}

function easeOutCubic(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 1 - (1 - clamped) ** 3;
}

function formatCameraView(view: Readonly<GridPoint & {
  width: number;
  height: number;
}>): string {
  return [view.x, view.y, view.width, view.height]
    .map((value) => value.toFixed(2))
    .join(",");
}
