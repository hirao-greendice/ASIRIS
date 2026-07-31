export type TileKind = "floor" | "grass" | "wall";

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraArea {
  /** Stable name used while editing and debugging the stage. */
  id: string;
  /** Player tile range that activates this camera. */
  trigger: GridRect;
  /**
   * Tile rectangle shown inside the square game screen.
   * Unlike logical tile positions, its coordinates may use half-tile values.
   */
  view: GridRect;
  /** Zero snaps immediately; a positive value pans between views. */
  transitionMs: number;
}

export interface RoomDefinition extends CameraArea {
  /** Human-readable room name used while editing the connected stage. */
  name: string;
  /** Full room rectangle including the surrounding shared walls. */
  bounds: GridRect;
  /** Default tile where this room's single puzzle can be placed later. */
  puzzleAnchor: GridPoint;
}

export type NamedObjectKind =
  | "tree"
  | "sun"
  | "moon"
  | "slime"
  | "calendar";
export type SwordMode = "kana" | "english";

export interface NamedObjectDefinition {
  id: string;
  names: Readonly<Record<SwordMode, string>>;
  kind: NamedObjectKind;
  position: GridPoint;
}

export interface DoorDefinition {
  position: GridPoint;
}

export interface FusionRuleDefinition {
  components: readonly string[];
  result: string;
}

export interface PuzzleGoalDefinition {
  position: GridPoint;
  result: string;
}

export interface PuzzleDefinition {
  id: string;
  roomId: string;
  number: number;
  title: string;
  answer: string;
  hint: string;
  playerStart: GridPoint;
  playerFacing: "up" | "down" | "left" | "right";
  namedObjects: readonly NamedObjectDefinition[];
  fusionRules: readonly FusionRuleDefinition[];
  goal: PuzzleGoalDefinition;
  door: DoorDefinition;
}

export interface StageDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: readonly (readonly TileKind[])[];
  playerStart: GridPoint;
  rooms: readonly RoomDefinition[];
  cameraAreas: readonly CameraArea[];
  /** Optional playable puzzle sequence used by the core-gimmick prototype. */
  puzzles?: readonly PuzzleDefinition[];
}

export function containsTile(rect: GridRect, point: GridPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

export function isWalkable(
  stage: StageDefinition,
  point: GridPoint,
): boolean {
  return stage.tiles[point.y]?.[point.x] !== undefined &&
    stage.tiles[point.y][point.x] !== "wall";
}
