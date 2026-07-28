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
  /** Tile rectangle shown inside the square game screen. */
  view: GridRect;
  /** Zero snaps immediately; a positive value pans between views. */
  transitionMs: number;
}

export interface StageDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: readonly (readonly TileKind[])[];
  playerStart: GridPoint;
  cameraAreas: readonly CameraArea[];
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
