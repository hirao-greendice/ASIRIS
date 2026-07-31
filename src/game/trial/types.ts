import type { HeroDirection } from "../assets/GameAssets";
import type { GridPoint, GridRect } from "../core/stageTypes";

export type SlashLanguage = "jp" | "en";

export type TrialAction =
  | HeroDirection
  | "slash-jp"
  | "slash-en"
  | "reset";

export type TrialTerrain = "floor" | "wall";

export type NamedEntityKind =
  | "snake"
  | "stone"
  | "shield"
  | "crown"
  | "knight"
  | "key"
  | "bat"
  | "fence"
  | "mimic"
  | "fire";

export interface TrialCameraArea {
  id: string;
  trigger: GridRect;
  view: GridRect;
  transitionMs: number;
}

export interface NamedEntityDefinition {
  id: string;
  symbol: string;
  kind: NamedEntityKind;
  position: GridPoint;
  jpName: string;
  enName: string;
  slashable: boolean;
  isUnknown: boolean;
  behavior: "static" | "chaser";
}

export interface SightEnemyDefinition {
  id: string;
  position: GridPoint;
  direction: HeroDirection;
}

export interface SwitchDefinition {
  id: string;
  position: GridPoint;
}

export interface DoorDefinition {
  id: string;
  position: GridPoint;
  requiredSwitchIds: readonly string[];
  requiredConditionIds: readonly string[];
}

export interface FusionWallDefinition {
  id: string;
  position: GridPoint;
  inputDirection: HeroDirection;
  recipe: readonly string[];
  result: string;
  conditionId: string;
}

export interface TrialStageDefinition {
  id: string;
  number: number;
  title: string;
  hint: string;
  width: number;
  height: number;
  mapRows: readonly string[];
  terrain: readonly (readonly TrialTerrain[])[];
  playerStart: GridPoint;
  playerFacing: HeroDirection;
  objects: readonly NamedEntityDefinition[];
  sightEnemies: readonly SightEnemyDefinition[];
  switches: readonly SwitchDefinition[];
  doors: readonly DoorDefinition[];
  goals: readonly GridPoint[];
  fusionWalls: readonly FusionWallDefinition[];
  cameraAreas: readonly TrialCameraArea[];
  solutionActions: readonly TrialAction[];
}

export interface NamedEntityState {
  id: string;
  position: GridPoint;
  isAlive: boolean;
}

export interface TrialLetterState {
  id: string;
  sourceEntityId: string;
  character: string;
  position: GridPoint;
}

export type TrialStatus = "playing" | "failed" | "completed";

export interface TrialRunState {
  player: GridPoint;
  facing: HeroDirection;
  objects: readonly NamedEntityState[];
  letters: readonly TrialLetterState[];
  activeConditionIds: readonly string[];
  openDoorIds: readonly string[];
  turnCount: number;
  status: TrialStatus;
  failureReason?: "caught" | "sight";
}

export interface TrialCampaignState {
  stageIndex: number;
  run: TrialRunState;
  discoveredUnknownIds: readonly string[];
  isClear: boolean;
}

export interface SlashEvent {
  language: SlashLanguage;
  targetEntityId?: string;
  name?: string;
  succeeded: boolean;
  blockedAt?: GridPoint;
  revealed?: {
    entityId: string;
    jpName: string;
    enName: string;
  };
  spawnedLetterIds?: readonly string[];
}

export interface FusionEvent {
  wallId: string;
  result: string;
  consumedLetters: readonly {
    character: string;
    position: GridPoint;
  }[];
}

export interface TrialActionResult {
  state: TrialCampaignState;
  consumedTurn: boolean;
  movedPlayer: boolean;
  pushedLetterId?: string;
  slash?: SlashEvent;
  fusion?: FusionEvent;
  failed: boolean;
  completed: boolean;
}
