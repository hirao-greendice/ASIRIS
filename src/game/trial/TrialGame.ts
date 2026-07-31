import type {
  GameAssets,
  HeroDirection,
} from "../assets/GameAssets";
import { SoundEffects } from "../audio/SoundEffects";
import type {
  DirectionControl,
  GameControl,
  InputController,
} from "../core/InputController";
import type { GridPoint, GridRect } from "../core/stageTypes";
import {
  advanceTrialStage,
  createTrialCampaignState,
  getActiveTrialStage,
  getChaserNextMove,
  getDangerTileKeys,
  getEntityDefinition,
  getFacingEntity,
  isDoorOpen,
  isSwitchOn,
  resetTrialStage,
  resolveTrialAction,
} from "./rules";
import { trialStages } from "./stages";
import type {
  FusionEvent,
  NamedEntityDefinition,
  TrialAction,
  TrialActionResult,
  TrialCampaignState,
  TrialLetterState,
  TrialStageDefinition,
} from "./types";

const KNOWLEDGE_STORAGE_KEY = "mirishira-sword.discovered-names.v1";
const STEP_SECONDS = 0.18;
const HOLD_DELAY_SECONDS = 0.29;
const HOLD_REPEAT_SECONDS = 0.22;
const ATTACK_SECONDS = 0.2;
const SPAWN_SECONDS = 0.3;
const COMPLETION_SECONDS = 0.62;
const STAGE_BANNER_SECONDS = 1.05;

const DIRECTION_ARROW: Readonly<Record<HeroDirection, string>> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

export interface TrialGameHud {
  stageLabel: HTMLElement;
  stageSelect: HTMLSelectElement;
  hintLabel: HTMLElement;
  nameLabel: HTMLElement;
  turnLabel: HTMLElement;
}

interface TileMotion {
  from: GridPoint;
  to: GridPoint;
  elapsed: number;
  duration: number;
}

interface SpawnEffect {
  source: GridPoint;
  letterIds: readonly string[];
  elapsed: number;
}

interface BlockedEffect {
  positions: readonly GridPoint[];
  elapsed: number;
}

interface RevealEffect {
  jpName: string;
  enName: string;
  elapsed: number;
}

interface FusionVisual extends FusionEvent {
  elapsed: number;
}

interface PitVisual {
  character: string;
  from: GridPoint;
  position: GridPoint;
  elapsed: number;
}

interface TrialDebugApi {
  snapshot: () => unknown;
  dispatch: (action: TrialAction) => void;
}

type DebugWindow = Window & {
  __MIRISHIRA_DEBUG__?: TrialDebugApi;
};

export class TrialGame {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly soundEffects = new SoundEffects();
  private state = createTrialCampaignState(loadDiscoveredNames());
  private animationFrame = 0;
  private previousTime = performance.now();
  private visualTime = 0;
  private actionCooldown = 0;
  private transitionCountdown = 0;
  private transitionKind: "failed" | "completed" | null = null;
  private repeatDirection: DirectionControl | null = null;
  private repeatCountdown = 0;
  private playerMotion: TileMotion | null = null;
  private readonly letterMotions = new Map<string, TileMotion>();
  private spawnEffect: SpawnEffect | null = null;
  private blockedEffect: BlockedEffect | null = null;
  private revealEffect: RevealEffect | null = null;
  private fusionVisual: FusionVisual | null = null;
  private pitVisual: PitVisual | null = null;
  private attackRemaining = 0;
  private attackLanguage: "jp" | "en" = "jp";
  private stageBannerRemaining = STAGE_BANNER_SECONDS;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: InputController,
    private readonly assets: GameAssets,
    private readonly hud: TrialGameHud,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is not available.");
    this.context = context;
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    this.resize();
    this.populateStageSelect();
    this.hud.stageSelect.addEventListener(
      "change",
      this.handleStageSelection,
    );
    this.hud.stageSelect.addEventListener(
      "keydown",
      this.stopStageSelectKeyPropagation,
    );
    this.syncHud();
    this.installDebugApi();
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.hud.stageSelect.removeEventListener(
      "change",
      this.handleStageSelection,
    );
    this.hud.stageSelect.removeEventListener(
      "keydown",
      this.stopStageSelectKeyPropagation,
    );
    this.soundEffects.destroy();
    delete (window as DebugWindow).__MIRISHIRA_DEBUG__;
  }

  private resize = (): void => {
    const size = Math.max(1, Math.round(this.canvas.clientWidth));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(size * pixelRatio);
    this.canvas.height = Math.round(size * pixelRatio);
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
    this.actionCooldown = Math.max(0, this.actionCooldown - deltaSeconds);
    this.attackRemaining = Math.max(0, this.attackRemaining - deltaSeconds);
    this.stageBannerRemaining = Math.max(
      0,
      this.stageBannerRemaining - deltaSeconds,
    );
    this.updateMotion(this.playerMotion, deltaSeconds, () => {
      this.playerMotion = null;
    });
    for (const [id, motion] of this.letterMotions) {
      motion.elapsed += deltaSeconds;
      if (motion.elapsed >= motion.duration) this.letterMotions.delete(id);
    }
    if (this.spawnEffect) {
      this.spawnEffect.elapsed += deltaSeconds;
      if (
        this.spawnEffect.elapsed >=
        SPAWN_SECONDS + this.spawnEffect.letterIds.length * 0.035
      ) {
        this.spawnEffect = null;
      }
    }
    if (this.blockedEffect) {
      this.blockedEffect.elapsed += deltaSeconds;
      if (this.blockedEffect.elapsed >= 0.34) this.blockedEffect = null;
    }
    if (this.revealEffect) {
      this.revealEffect.elapsed += deltaSeconds;
      if (this.revealEffect.elapsed >= 1.05) this.revealEffect = null;
    }
    if (this.fusionVisual) {
      this.fusionVisual.elapsed += deltaSeconds;
      if (this.fusionVisual.elapsed >= 0.42) this.fusionVisual = null;
    }
    if (this.pitVisual) {
      this.pitVisual.elapsed += deltaSeconds;
      if (this.pitVisual.elapsed >= 0.34) this.pitVisual = null;
    }

    if (this.transitionKind === "completed") {
      this.transitionCountdown -= deltaSeconds;
      if (this.transitionCountdown <= 0) this.finishTransition();
    }

    this.updateHeldDirection(deltaSeconds);
    if (this.input.consumePress("reset")) {
      this.handleControl("reset");
    } else {
      const control = this.input.consumeNextPress();
      if (control) {
        this.handleControl(control);
      } else if (this.actionCooldown <= 0 && !this.transitionKind) {
        this.tryHeldMove();
      }
    }

    this.updateDebugDataset();
  }

  private updateMotion(
    motion: TileMotion | null,
    deltaSeconds: number,
    finish: () => void,
  ): void {
    if (!motion) return;
    motion.elapsed += deltaSeconds;
    if (motion.elapsed >= motion.duration) finish();
  }

  private updateHeldDirection(deltaSeconds: number): void {
    const preferred = this.input.getPreferredDirection();
    if (!preferred || this.transitionKind || this.state.isClear) {
      this.repeatDirection = null;
      this.repeatCountdown = 0;
      return;
    }
    if (preferred !== this.repeatDirection) {
      this.repeatDirection = preferred;
      this.repeatCountdown = HOLD_DELAY_SECONDS;
      return;
    }
    this.repeatCountdown -= deltaSeconds;
  }

  private tryHeldMove(): void {
    if (!this.repeatDirection || this.repeatCountdown > 0) return;
    this.performAction(this.repeatDirection);
    this.repeatCountdown = HOLD_REPEAT_SECONDS;
  }

  private handleControl(control: GameControl): void {
    if (control === "reset") {
      this.resetNow();
      return;
    }
    if (this.transitionKind || this.state.isClear) return;
    if (isDirection(control)) {
      this.repeatDirection = control;
      this.repeatCountdown = HOLD_DELAY_SECONDS;
      this.performAction(control);
      return;
    }
    if (control === "slash-jp" || control === "primary") {
      this.performAction("slash-jp");
      return;
    }
    if (control === "slash-en") {
      this.performAction("slash-en");
    }
  }

  private performAction(action: TrialAction): void {
    if (action === "reset") {
      this.resetNow();
      return;
    }
    if (this.transitionKind || this.state.isClear) return;

    const previous = this.state;
    const result = resolveTrialAction(previous, action);
    this.state = result.state;
    this.createVisuals(previous, result);
    this.playActionSound(result);
    this.syncHud();
    saveDiscoveredNames(this.state.discoveredUnknownIds);

    this.actionCooldown = result.consumedTurn ? STEP_SECONDS : 0.055;
    if (result.failed) {
      this.transitionKind = "failed";
      this.transitionCountdown = 0;
    } else if (result.completed) {
      this.transitionKind = "completed";
      this.transitionCountdown = COMPLETION_SECONDS;
    }
  }

  private createVisuals(
    previous: TrialCampaignState,
    result: TrialActionResult,
  ): void {
    const next = result.state;
    if (
      result.movedPlayer &&
      !pointsEqual(previous.run.player, next.run.player)
    ) {
      this.playerMotion = {
        from: { ...previous.run.player },
        to: { ...next.run.player },
        elapsed: 0,
        duration: STEP_SECONDS,
      };
    }

    if (result.pushedLetterId) {
      const before = previous.run.letters.find(
        (entry) => entry.id === result.pushedLetterId,
      );
      const after = next.run.letters.find(
        (entry) => entry.id === result.pushedLetterId,
      );
      if (before && after) {
        this.letterMotions.set(result.pushedLetterId, {
          from: { ...before.position },
          to: { ...after.position },
          elapsed: 0,
          duration: STEP_SECONDS,
        });
      }
    }

    if (result.slash) {
      this.attackRemaining = ATTACK_SECONDS;
      this.attackLanguage = result.slash.language;
      if (
        result.slash.succeeded &&
        result.slash.targetEntityId &&
        result.slash.spawnedLetterIds
      ) {
        const targetEntityId = result.slash.targetEntityId;
        const previousEntity = previous.run.objects.find(
          (entry) => entry.id === targetEntityId,
        );
        this.spawnEffect = {
          source: {
            ...(previousEntity?.position ?? previous.run.player),
          },
          letterIds: result.slash.spawnedLetterIds,
          elapsed: 0,
        };
      } else if (result.slash.blockedAt) {
        this.blockedEffect = {
          positions: (
            result.slash.attemptedPositions ?? [result.slash.blockedAt]
          ).map((position) => ({ ...position })),
          elapsed: 0,
        };
      }
      if (result.slash.revealed) {
        this.revealEffect = {
          jpName: result.slash.revealed.jpName,
          enName: result.slash.revealed.enName,
          elapsed: 0,
        };
      }
    }

    if (result.fusion) {
      this.fusionVisual = { ...result.fusion, elapsed: 0 };
    }
    if (result.filledPit) {
      this.pitVisual = {
        character: result.filledPit.character,
        from: { ...result.filledPit.from },
        position: { ...result.filledPit.position },
        elapsed: 0,
      };
    }
  }

  private playActionSound(result: TrialActionResult): void {
    if (result.slash) {
      this.soundEffects.slash();
      if (!result.slash.succeeded) this.soundEffects.blocked();
      if (result.slash.revealed) this.soundEffects.reveal();
    }
    if (result.pushedLetterId) this.soundEffects.lockLetter();
    if (result.filledPit) this.soundEffects.drop();
    if (result.fusion) this.soundEffects.fuse();
    if (result.failed) this.soundEffects.danger();
    if (result.completed) this.soundEffects.solve();
  }

  private finishTransition(): void {
    const kind = this.transitionKind;
    this.transitionKind = null;
    this.transitionCountdown = 0;
    if (kind === "completed") {
      this.state = advanceTrialStage(this.state);
      this.soundEffects.door();
      this.stageBannerRemaining = STAGE_BANNER_SECONDS;
    }
    this.clearVisuals();
    this.input.clearPendingPresses();
    this.actionCooldown = 0.08;
    this.syncHud();
  }

  private resetNow(): void {
    this.state = resetTrialStage(this.state);
    this.transitionKind = null;
    this.transitionCountdown = 0;
    this.clearVisuals();
    this.input.clearPendingPresses();
    this.repeatDirection = null;
    this.stageBannerRemaining = 0;
    this.actionCooldown = 0.08;
    this.soundEffects.reset();
    this.syncHud();
  }

  private populateStageSelect(): void {
    const options = trialStages.map((stage, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent =
        `${String(stage.number).padStart(2, "0")}　${stage.title}` +
        `　[${stage.width}×${stage.height}]`;
      return option;
    });
    this.hud.stageSelect.replaceChildren(...options);
  }

  private handleStageSelection = (): void => {
    const stageIndex = Number.parseInt(this.hud.stageSelect.value, 10);
    if (
      !Number.isInteger(stageIndex) ||
      stageIndex < 0 ||
      stageIndex >= trialStages.length
    ) {
      this.hud.stageSelect.value = String(this.state.stageIndex);
      return;
    }

    this.state = createTrialCampaignState(
      this.state.discoveredUnknownIds,
      stageIndex,
    );
    this.transitionKind = null;
    this.transitionCountdown = 0;
    this.clearVisuals();
    this.input.clearPendingPresses();
    this.repeatDirection = null;
    this.repeatCountdown = 0;
    this.actionCooldown = 0.08;
    this.stageBannerRemaining = STAGE_BANNER_SECONDS;
    this.soundEffects.reset();
    this.syncHud();
  };

  private stopStageSelectKeyPropagation = (
    event: KeyboardEvent,
  ): void => {
    event.stopPropagation();
  };

  private clearVisuals(): void {
    this.playerMotion = null;
    this.letterMotions.clear();
    this.spawnEffect = null;
    this.blockedEffect = null;
    this.revealEffect = null;
    this.fusionVisual = null;
    this.pitVisual = null;
    this.attackRemaining = 0;
  }

  private syncHud(): void {
    const stage = getActiveTrialStage(this.state);
    this.hud.stageLabel.textContent =
      `STAGE ${stage.number} / ${trialStages.length}`;
    this.hud.stageSelect.value = String(this.state.stageIndex);
    this.hud.hintLabel.textContent = stage.hint;
    this.hud.turnLabel.textContent = `TURN ${this.state.run.turnCount}`;

    const persistentTarget = stage.displayTargetEntityId
      ? stage.objects.find(
          (entry) => entry.id === stage.displayTargetEntityId,
        )
      : undefined;
    if (persistentTarget) {
      this.hud.nameLabel.textContent =
        `対象：${persistentTarget.jpName} / ${persistentTarget.enName}`;
      this.hud.nameLabel.dataset.unknown = "false";
      return;
    }

    const facing = getFacingEntity(this.state);
    if (!facing) {
      this.hud.nameLabel.textContent = "対象：—";
      this.hud.nameLabel.dataset.unknown = "false";
    } else if (!facing.isDiscovered) {
      this.hud.nameLabel.textContent = "JP：???　/　EN：???";
      this.hud.nameLabel.dataset.unknown = "true";
    } else {
      this.hud.nameLabel.textContent =
        `JP：${facing.definition.jpName}　/　EN：${facing.definition.enName}`;
      this.hud.nameLabel.dataset.unknown = "false";
    }
  }

  private draw(): void {
    const pixelRatio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const size = this.canvas.clientWidth;
    const context = this.context;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, size, size);
    context.fillStyle = "#0c0910";
    context.fillRect(0, 0, size, size);

    const stage = getActiveTrialStage(this.state);
    const camera = stage.cameraAreas[0].view;
    const tileSize = size / camera.width;
    this.drawTerrain(stage, camera, tileSize);
    this.drawDanger(stage, camera, tileSize);
    this.drawFloorDevices(stage, camera, tileSize);
    this.drawChaserPredictions(stage, camera, tileSize);
    this.drawFusionWalls(stage, camera, tileSize);
    this.drawObjects(stage, camera, tileSize);
    this.drawSightEnemies(stage, camera, tileSize);
    this.drawLetters(camera, tileSize);
    this.drawFusionVisual(camera, tileSize);
    this.drawPitVisual(camera, tileSize);
    this.drawPlayer(camera, tileSize);
    this.drawEffects(camera, tileSize);
    this.drawOverlay(size);
  }

  private drawTerrain(
    stage: TrialStageDefinition,
    camera: GridRect,
    tileSize: number,
  ): void {
    const context = this.context;
    for (let y = 0; y < stage.height; y += 1) {
      for (let x = 0; x < stage.width; x += 1) {
        const point = { x, y };
        const rect = this.cellRect(point, camera, tileSize);
        const fusionWall = stage.fusionWalls.some((entry) =>
          pointsEqual(entry.position, point)
        );
        if (stage.terrain[y][x] === "pit") {
          const pit = stage.pits.find((entry) =>
            pointsEqual(entry.position, point)
          );
          const filled =
            pit !== undefined &&
            this.state.run.filledPitIds.includes(pit.id);
          context.fillStyle = filled ? "#2a242d" : "#090c12";
          context.fillRect(rect.x, rect.y, rect.size, rect.size);
          context.strokeStyle = filled ? "#75647a" : "#6892a2";
          context.lineWidth = Math.max(1.5, tileSize * 0.04);
          context.beginPath();
          context.ellipse(
            rect.x + tileSize / 2,
            rect.y + tileSize / 2,
            tileSize * 0.34,
            tileSize * 0.22,
            0,
            0,
            Math.PI * 2,
          );
          context.fillStyle = filled ? "#443847" : "#05070b";
          context.fill();
          context.stroke();
          this.drawCenteredText(
            filled ? "床" : "≈",
            rect,
            filled ? "#aa96ae" : "#9cc7d3",
            filled ? 0.2 : 0.42,
            700,
          );
          continue;
        }
        if (stage.terrain[y][x] === "wall" && !fusionWall) {
          context.fillStyle = (x + y) % 2 === 0 ? "#28222b" : "#241f27";
          context.fillRect(rect.x, rect.y, rect.size + 0.5, rect.size + 0.5);
          context.strokeStyle = "rgba(199, 165, 204, 0.16)";
          context.lineWidth = Math.max(1, tileSize * 0.025);
          context.strokeRect(
            rect.x + 1,
            rect.y + 1,
            rect.size - 2,
            rect.size - 2,
          );
          continue;
        }

        context.fillStyle = (x + y) % 2 === 0 ? "#17131a" : "#1a161d";
        context.fillRect(rect.x, rect.y, rect.size + 0.5, rect.size + 0.5);
        context.strokeStyle = "rgba(231, 222, 233, 0.055)";
        context.lineWidth = 1;
        context.strokeRect(rect.x, rect.y, rect.size, rect.size);
      }
    }
  }

  private drawDanger(
    stage: TrialStageDefinition,
    camera: GridRect,
    tileSize: number,
  ): void {
    const dangerous = getDangerTileKeys(this.state);
    for (let y = 0; y < stage.height; y += 1) {
      for (let x = 0; x < stage.width; x += 1) {
        if (!dangerous.has(`${x},${y}`)) continue;
        const rect = this.cellRect({ x, y }, camera, tileSize);
        const pulse = 0.12 + Math.sin(this.visualTime * 4.5) * 0.025;
        this.context.fillStyle = `rgba(215, 58, 75, ${pulse})`;
        this.context.fillRect(rect.x, rect.y, rect.size, rect.size);
        this.context.fillStyle = "rgba(239, 74, 89, 0.46)";
        if (stage.sightEnemies.length > 0) {
          const stripe = Math.max(2, tileSize * 0.08);
          this.context.fillRect(
            rect.x,
            rect.y + rect.size / 2 - stripe / 2,
            rect.size,
            stripe,
          );
        }
      }
    }
  }

  private drawFloorDevices(
    stage: TrialStageDefinition,
    camera: GridRect,
    tileSize: number,
  ): void {
    const context = this.context;
    for (const entry of stage.switches) {
      const rect = this.cellRect(entry.position, camera, tileSize);
      const on = isSwitchOn(this.state.run, entry.position);
      context.save();
      context.strokeStyle = on ? "#f0d9f3" : "#92769a";
      context.fillStyle = on
        ? "rgba(199, 165, 204, 0.34)"
        : "rgba(199, 165, 204, 0.08)";
      context.lineWidth = Math.max(1.5, tileSize * 0.045);
      context.setLineDash([tileSize * 0.12, tileSize * 0.09]);
      context.fillRect(
        rect.x + tileSize * 0.13,
        rect.y + tileSize * 0.13,
        tileSize * 0.74,
        tileSize * 0.74,
      );
      context.strokeRect(
        rect.x + tileSize * 0.13,
        rect.y + tileSize * 0.13,
        tileSize * 0.74,
        tileSize * 0.74,
      );
      context.restore();
    }

    for (const goal of stage.goals) {
      if (
        stage.doors.some((door) => pointsEqual(door.position, goal))
      ) {
        continue;
      }
      const rect = this.cellRect(goal, camera, tileSize);
      context.fillStyle = "rgba(191, 222, 200, 0.12)";
      context.fillRect(
        rect.x + tileSize * 0.08,
        rect.y + tileSize * 0.08,
        tileSize * 0.84,
        tileSize * 0.84,
      );
      context.strokeStyle = "#9fc8a9";
      context.lineWidth = Math.max(1.5, tileSize * 0.04);
      context.strokeRect(
        rect.x + tileSize * 0.1,
        rect.y + tileSize * 0.1,
        tileSize * 0.8,
        tileSize * 0.8,
      );
      this.drawCenteredText("G", rect, "#cce5d3", 0.46, 700);
    }

    for (const door of stage.doors) {
      const rect = this.cellRect(door.position, camera, tileSize);
      const open = isDoorOpen(this.state.run, stage, door);
      context.save();
      context.fillStyle = open ? "rgba(199, 165, 204, 0.12)" : "#4b3b50";
      context.strokeStyle = open ? "#c7a5cc" : "#8a728e";
      context.lineWidth = Math.max(1.5, tileSize * 0.045);
      if (open) context.setLineDash([tileSize * 0.12, tileSize * 0.08]);
      context.fillRect(
        rect.x + tileSize * 0.12,
        rect.y + tileSize * 0.04,
        tileSize * 0.76,
        tileSize * 0.92,
      );
      context.strokeRect(
        rect.x + tileSize * 0.12,
        rect.y + tileSize * 0.04,
        tileSize * 0.76,
        tileSize * 0.92,
      );
      context.restore();
      this.drawCenteredText(
        open ? "EXIT" : "D",
        rect,
        open ? "#eadced" : "#f0e8f1",
        open ? 0.2 : 0.4,
        700,
      );
    }
  }

  private drawChaserPredictions(
    stage: TrialStageDefinition,
    camera: GridRect,
    tileSize: number,
  ): void {
    for (const entity of this.state.run.objects) {
      if (!entity.isAlive) continue;
      const definition = getEntityDefinition(stage, entity.id);
      if (definition.behavior !== "chaser") continue;
      const next = getChaserNextMove(this.state, entity.id);
      if (!next) continue;
      const rect = this.cellRect(next, camera, tileSize);
      const dx = next.x - entity.position.x;
      const dy = next.y - entity.position.y;
      const direction: HeroDirection =
        dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up";
      this.context.fillStyle = "rgba(230, 157, 98, 0.16)";
      this.context.fillRect(
        rect.x + tileSize * 0.14,
        rect.y + tileSize * 0.14,
        tileSize * 0.72,
        tileSize * 0.72,
      );
      this.drawCenteredText(
        DIRECTION_ARROW[direction],
        rect,
        "rgba(255, 202, 154, 0.72)",
        0.5,
        700,
      );
    }
  }

  private drawFusionWalls(
    stage: TrialStageDefinition,
    camera: GridRect,
    tileSize: number,
  ): void {
    for (const wall of stage.fusionWalls) {
      const rect = this.cellRect(wall.position, camera, tileSize);
      const active = this.state.run.activeConditionIds.includes(
        wall.conditionId,
      );
      this.context.fillStyle = active ? "#49343d" : "#322a36";
      this.context.fillRect(rect.x, rect.y, rect.size, rect.size);
      this.context.strokeStyle = active ? "#e5b7a9" : "#c7a5cc";
      this.context.lineWidth = Math.max(2, tileSize * 0.055);
      this.context.strokeRect(
        rect.x + tileSize * 0.07,
        rect.y + tileSize * 0.07,
        tileSize * 0.86,
        tileSize * 0.86,
      );
      this.drawCenteredText(
        active ? wall.result : "火+火",
        rect,
        active ? "#ffd5c5" : "#e8dbea",
        active ? 0.58 : 0.23,
        800,
      );
    }
  }

  private drawObjects(
    stage: TrialStageDefinition,
    camera: GridRect,
    tileSize: number,
  ): void {
    for (const entity of this.state.run.objects) {
      if (!entity.isAlive) continue;
      const definition = getEntityDefinition(stage, entity.id);
      const rect = this.cellRect(entity.position, camera, tileSize);
      this.drawObject(definition, rect, tileSize);
    }
  }

  private drawObject(
    definition: NamedEntityDefinition,
    rect: { x: number; y: number; size: number },
    tileSize: number,
  ): void {
    const context = this.context;
    const discovered =
      !definition.isUnknown ||
      this.state.discoveredUnknownIds.includes(definition.id);
    const chaser = definition.behavior === "chaser";
    const colors = objectColors(definition.kind);

    context.save();
    context.fillStyle = colors.fill;
    context.strokeStyle = chaser ? "#f0a36e" : colors.stroke;
    context.lineWidth = Math.max(1.5, tileSize * (chaser ? 0.065 : 0.04));
    context.beginPath();
    context.roundRect(
      rect.x + tileSize * 0.13,
      rect.y + tileSize * 0.12,
      tileSize * 0.74,
      tileSize * 0.68,
      tileSize * 0.16,
    );
    context.fill();
    context.stroke();
    context.restore();

    this.drawCenteredText(
      discovered ? definition.symbol : "?",
      {
        x: rect.x,
        y: rect.y - tileSize * 0.09,
        size: rect.size,
      },
      colors.text,
      0.38,
      800,
    );

    const label = discovered ? definition.jpName : "???";
    context.fillStyle = "#f5edf6";
    context.font =
      `700 ${Math.max(7, tileSize * (label.length > 3 ? 0.14 : 0.17))}px ` +
      '"Yu Gothic", Meiryo, sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      label,
      rect.x + tileSize / 2,
      rect.y + tileSize * 0.79,
      tileSize * 0.92,
    );
  }

  private drawSightEnemies(
    stage: TrialStageDefinition,
    camera: GridRect,
    tileSize: number,
  ): void {
    for (const enemy of stage.sightEnemies) {
      const rect = this.cellRect(enemy.position, camera, tileSize);
      this.context.fillStyle = "#5b2732";
      this.context.beginPath();
      this.context.arc(
        rect.x + tileSize / 2,
        rect.y + tileSize / 2,
        tileSize * 0.31,
        0,
        Math.PI * 2,
      );
      this.context.fill();
      this.context.strokeStyle = "#f06d78";
      this.context.lineWidth = Math.max(1.5, tileSize * 0.045);
      this.context.stroke();
      this.drawCenteredText(
        DIRECTION_ARROW[enemy.direction],
        rect,
        "#ffe7e8",
        0.45,
        800,
      );
    }
  }

  private drawLetters(camera: GridRect, tileSize: number): void {
    for (const letter of this.state.run.letters) {
      const position = this.getLetterDrawPosition(letter);
      const spawn = this.getSpawnProgress(letter);
      const scale = spawn?.scale ?? 1;
      const rect = this.cellRect(position, camera, tileSize);
      const inset = tileSize * (0.1 + (1 - scale) * 0.35);
      this.context.save();
      this.context.shadowColor = "rgba(199, 165, 204, 0.44)";
      this.context.shadowBlur = tileSize * 0.12 * scale;
      this.context.fillStyle = "#eee8ef";
      this.context.strokeStyle = "#c7a5cc";
      this.context.lineWidth = Math.max(1.5, tileSize * 0.045);
      this.context.beginPath();
      this.context.roundRect(
        rect.x + inset,
        rect.y + inset,
        tileSize - inset * 2,
        tileSize - inset * 2,
        tileSize * 0.08,
      );
      this.context.fill();
      this.context.stroke();
      this.context.restore();
      this.drawCenteredText(
        letter.character,
        rect,
        "#171119",
        letter.character.length > 1 ? 0.34 : 0.5,
        900,
      );
    }
  }

  private getLetterDrawPosition(letter: TrialLetterState): GridPoint {
    const motion = this.letterMotions.get(letter.id);
    if (motion) return interpolateMotion(motion);
    const spawn = this.getSpawnProgress(letter);
    if (spawn && this.spawnEffect) {
      return interpolatePoint(
        this.spawnEffect.source,
        letter.position,
        spawn.progress,
      );
    }
    return letter.position;
  }

  private getSpawnProgress(
    letter: TrialLetterState,
  ): { progress: number; scale: number } | undefined {
    if (!this.spawnEffect) return undefined;
    const index = this.spawnEffect.letterIds.indexOf(letter.id);
    if (index < 0) return undefined;
    const localTime = this.spawnEffect.elapsed - index * 0.035;
    const progress = clamp(localTime / SPAWN_SECONDS, 0, 1);
    return {
      progress: easeOutCubic(progress),
      scale: clamp(progress * 1.35, 0.15, 1),
    };
  }

  private drawFusionVisual(camera: GridRect, tileSize: number): void {
    if (!this.fusionVisual) return;
    const stage = getActiveTrialStage(this.state);
    const wall = stage.fusionWalls.find(
      (entry) => entry.id === this.fusionVisual?.wallId,
    );
    if (!wall) return;
    const progress = easeInCubic(
      clamp(this.fusionVisual.elapsed / 0.32, 0, 1),
    );
    for (const consumed of this.fusionVisual.consumedLetters) {
      const position = interpolatePoint(
        consumed.position,
        wall.position,
        progress,
      );
      const rect = this.cellRect(position, camera, tileSize);
      this.context.globalAlpha = 1 - progress;
      this.drawCenteredText(
        consumed.character,
        rect,
        "#fff4ff",
        0.5 * (1 - progress * 0.4),
        900,
      );
      this.context.globalAlpha = 1;
    }
  }

  private drawPitVisual(camera: GridRect, tileSize: number): void {
    if (!this.pitVisual) return;
    const progress = easeInCubic(
      clamp(this.pitVisual.elapsed / 0.3, 0, 1),
    );
    const position = interpolatePoint(
      this.pitVisual.from,
      this.pitVisual.position,
      progress,
    );
    position.y += progress * 0.18;
    const rect = this.cellRect(position, camera, tileSize);
    this.context.globalAlpha = 1 - progress * 0.85;
    this.drawCenteredText(
      this.pitVisual.character,
      rect,
      "#f4eaf5",
      0.5 * (1 - progress * 0.45),
      900,
    );
    this.context.globalAlpha = 1;
  }

  private drawPlayer(camera: GridRect, tileSize: number): void {
    const position = this.playerMotion
      ? interpolateMotion(this.playerMotion)
      : this.state.run.player;
    const rect = this.cellRect(position, camera, tileSize);
    const attacking = this.attackRemaining > 0;
    const image = attacking
      ? this.assets.hero.attack[this.state.run.facing]
      : this.assets.hero.idle[this.state.run.facing];
    const size = tileSize * (attacking ? 1.62 : 1.18);
    const originY = attacking ? 0.875 : 0.9;
    const x = rect.x + tileSize / 2 - size / 2;
    const y = rect.y + tileSize - size * originY;

    if (attacking) {
      this.context.save();
      this.context.shadowColor =
        this.attackLanguage === "jp" ? "#c7a5cc" : "#9fcbd2";
      this.context.shadowBlur = tileSize * 0.24;
      this.context.drawImage(image, x, y, size, size);
      this.context.restore();
    } else {
      this.context.drawImage(image, x, y, size, size);
    }
  }

  private drawEffects(camera: GridRect, tileSize: number): void {
    if (this.blockedEffect) {
      const progress = this.blockedEffect.elapsed / 0.34;
      for (const position of this.blockedEffect.positions) {
        const rect = this.cellRect(position, camera, tileSize);
        this.context.fillStyle =
          `rgba(236, 61, 76, ${0.42 * (1 - progress)})`;
        this.context.fillRect(rect.x, rect.y, rect.size, rect.size);
        this.context.strokeStyle =
          `rgba(255, 150, 157, ${0.9 * (1 - progress)})`;
        this.context.lineWidth = Math.max(2, tileSize * 0.07);
        this.context.strokeRect(
          rect.x + tileSize * 0.07,
          rect.y + tileSize * 0.07,
          tileSize * 0.86,
          tileSize * 0.86,
        );
      }
    }
  }

  private drawOverlay(size: number): void {
    const context = this.context;
    if (this.stageBannerRemaining > 0 && !this.state.isClear) {
      const stage = getActiveTrialStage(this.state);
      const alpha = clamp(this.stageBannerRemaining * 2.1, 0, 1);
      context.fillStyle = `rgba(11, 8, 13, ${0.76 * alpha})`;
      context.fillRect(0, size * 0.41, size, size * 0.18);
      context.fillStyle = `rgba(238, 226, 240, ${alpha})`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font =
        `800 ${Math.max(14, size * 0.045)}px ` +
        '"Yu Gothic", Meiryo, sans-serif';
      context.fillText(
        `${stage.number}. ${stage.title}`,
        size / 2,
        size / 2,
        size * 0.84,
      );
    }

    if (this.revealEffect) {
      const alpha = clamp(
        Math.min(
          this.revealEffect.elapsed / 0.12,
          (1.05 - this.revealEffect.elapsed) / 0.2,
        ),
        0,
        1,
      );
      context.fillStyle = `rgba(24, 17, 27, ${0.94 * alpha})`;
      context.fillRect(size * 0.08, size * 0.36, size * 0.84, size * 0.28);
      context.strokeStyle = `rgba(199, 165, 204, ${alpha})`;
      context.lineWidth = 2;
      context.strokeRect(
        size * 0.08,
        size * 0.36,
        size * 0.84,
        size * 0.28,
      );
      context.fillStyle = `rgba(240, 225, 242, ${alpha})`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `700 ${Math.max(12, size * 0.03)}px sans-serif`;
      context.fillText("名前が判明した", size / 2, size * 0.42);
      context.font = `900 ${Math.max(15, size * 0.045)}px sans-serif`;
      context.fillText(
        `JP  ${this.revealEffect.jpName}`,
        size / 2,
        size * 0.5,
      );
      context.fillText(
        `EN  ${this.revealEffect.enName}`,
        size / 2,
        size * 0.57,
      );
    }

    if (this.transitionKind === "failed") {
      context.fillStyle = "rgba(109, 12, 26, 0.38)";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#ffe2e5";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `900 ${Math.max(20, size * 0.07)}px sans-serif`;
      context.fillText(
        this.state.run.failureReason === "caught" ? "つかまった" : "見つかった",
        size / 2,
        size / 2,
      );
      context.font = `700 ${Math.max(11, size * 0.026)}px sans-serif`;
      context.fillText(
        "R またはリセットで再挑戦",
        size / 2,
        size * 0.58,
      );
    } else if (this.transitionKind === "completed") {
      const alpha = clamp(
        1 - this.transitionCountdown / COMPLETION_SECONDS,
        0,
        1,
      );
      context.fillStyle = `rgba(199, 165, 204, ${0.18 * alpha})`;
      context.fillRect(0, 0, size, size);
      context.fillStyle = `rgba(249, 239, 250, ${alpha})`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `900 ${Math.max(22, size * 0.075)}px sans-serif`;
      context.fillText("CLEAR", size / 2, size / 2);
    }

    if (this.state.isClear) {
      context.fillStyle = "rgba(10, 7, 12, 0.9)";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#f2e6f4";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font =
        `900 ${Math.max(24, size * 0.08)}px ` +
        '"Yu Gothic", Meiryo, sans-serif';
      context.fillText("試作クリア", size / 2, size * 0.46);
      context.fillStyle = "#c7a5cc";
      context.font = `600 ${Math.max(11, size * 0.028)}px sans-serif`;
      context.fillText(
        "R またはリセットで最初から",
        size / 2,
        size * 0.57,
      );
    }
  }

  private drawCenteredText(
    text: string,
    rect: { x: number; y: number; size: number },
    color: string,
    sizeRatio: number,
    weight: number,
  ): void {
    this.context.fillStyle = color;
    this.context.font =
      `${weight} ${Math.max(7, rect.size * sizeRatio)}px ` +
      '"Yu Gothic", Meiryo, sans-serif';
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";
    this.context.fillText(
      text,
      rect.x + rect.size / 2,
      rect.y + rect.size / 2,
      rect.size * 0.88,
    );
  }

  private cellRect(
    point: GridPoint,
    camera: GridRect,
    tileSize: number,
  ): { x: number; y: number; size: number } {
    return {
      x: (point.x - camera.x) * tileSize,
      y: (point.y - camera.y) * tileSize,
      size: tileSize,
    };
  }

  private installDebugApi(): void {
    (window as DebugWindow).__MIRISHIRA_DEBUG__ = {
      snapshot: () => this.createDebugSnapshot(),
      dispatch: (action) => this.performAction(action),
    };
  }

  private updateDebugDataset(): void {
    const snapshot = this.createDebugSnapshot();
    this.canvas.dataset.stage = String(snapshot.stage);
    this.canvas.dataset.status = snapshot.status;
    this.canvas.dataset.player = snapshot.player;
    this.canvas.dataset.turn = String(snapshot.turn);
    this.canvas.dataset.letters = snapshot.letters;
    this.canvas.dataset.doors = snapshot.doors;
    this.canvas.dataset.pits = snapshot.pits;
  }

  private createDebugSnapshot(): {
    stage: number;
    stageId: string;
    status: string;
    player: string;
    facing: HeroDirection;
    turn: number;
    letters: string;
    doors: string;
    pits: string;
    failureReason?: string;
    discovered: readonly string[];
    clear: boolean;
  } {
    const stage = getActiveTrialStage(this.state);
    return {
      stage: stage.number,
      stageId: stage.id,
      status: this.state.run.status,
      player: `${this.state.run.player.x},${this.state.run.player.y}`,
      facing: this.state.run.facing,
      turn: this.state.run.turnCount,
      letters: this.state.run.letters
        .map(
          (entry) =>
            `${entry.character}@${entry.position.x},${entry.position.y}`,
        )
        .join("|"),
      doors: stage.doors
        .map((door) => (isDoorOpen(this.state.run, stage, door) ? "open" : "closed"))
        .join("|"),
      pits: stage.pits
        .map((pit) =>
          this.state.run.filledPitIds.includes(pit.id) ? "filled" : "open"
        )
        .join("|"),
      failureReason: this.state.run.failureReason,
      discovered: [...this.state.discoveredUnknownIds],
      clear: this.state.isClear,
    };
  }
}

function loadDiscoveredNames(): string[] {
  try {
    const stored = sessionStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function saveDiscoveredNames(ids: readonly string[]): void {
  try {
    sessionStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // The game remains playable when storage is unavailable.
  }
}

function objectColors(kind: NamedEntityDefinition["kind"]): {
  fill: string;
  stroke: string;
  text: string;
} {
  switch (kind) {
    case "tree":
      return { fill: "#36503a", stroke: "#82ad87", text: "#e1f2e3" };
    case "fire":
      return { fill: "#74392f", stroke: "#de846b", text: "#ffd7c8" };
    case "bat":
    case "mimic":
      return { fill: "#46304d", stroke: "#bd91c7", text: "#f1dff4" };
    case "crown":
    case "key":
      return { fill: "#66552e", stroke: "#d8be69", text: "#fff0b5" };
    case "snake":
      return { fill: "#315443", stroke: "#78b694", text: "#d9f4e5" };
    case "shield":
    case "knight":
      return { fill: "#334a55", stroke: "#82abb9", text: "#e0f1f5" };
    case "stone":
    case "fence":
      return { fill: "#46434a", stroke: "#a5a0aa", text: "#f0edf2" };
  }
}

function isDirection(control: GameControl): control is DirectionControl {
  return (
    control === "up" ||
    control === "down" ||
    control === "left" ||
    control === "right"
  );
}

function interpolateMotion(motion: TileMotion): GridPoint {
  return interpolatePoint(
    motion.from,
    motion.to,
    easeOutCubic(clamp(motion.elapsed / motion.duration, 0, 1)),
  );
}

function interpolatePoint(
  from: GridPoint,
  to: GridPoint,
  progress: number,
): GridPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

function pointsEqual(first: GridPoint, second: GridPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInCubic(value: number): number {
  return value ** 3;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
