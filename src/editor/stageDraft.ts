import {
  containsTile,
  type GridPoint,
  type GridRect,
  type RoomDefinition,
  type StageDefinition,
  type TileKind,
} from "../game/core/stageTypes";

const STORAGE_KEY = "mirishira-sword:stage-draft:v1";
const FILE_FORMAT = "mirishira-stage";
const FILE_VERSION = 1;

export interface EditableStage {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  playerStart: GridPoint;
  rooms: RoomDefinition[];
}

interface StageDraftFile {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  stage: EditableStage;
}

export function createEditableStage(
  source: StageDefinition,
): EditableStage {
  return {
    id: source.id,
    name: source.name,
    width: source.width,
    height: source.height,
    tiles: source.tiles.map((row) => [...row]),
    playerStart: { ...source.playerStart },
    rooms: source.rooms.map(cloneRoom),
  };
}

export function toStageDefinition(
  editableStage: EditableStage,
): StageDefinition {
  return {
    ...editableStage,
    cameraAreas: editableStage.rooms,
  };
}

export function saveStageDraft(editableStage: EditableStage): void {
  localStorage.setItem(STORAGE_KEY, serializeStageDraft(editableStage));
}

export function loadStageDraft(): EditableStage | null {
  const serialized = localStorage.getItem(STORAGE_KEY);
  return serialized ? parseStageDraft(serialized) : null;
}

export function serializeStageDraft(
  editableStage: EditableStage,
): string {
  const file: StageDraftFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    stage: editableStage,
  };
  return JSON.stringify(file, null, 2);
}

export function parseStageDraft(serialized: string): EditableStage {
  const parsed: unknown = JSON.parse(serialized);
  const candidate =
    isRecord(parsed) && parsed.format === FILE_FORMAT
      ? parsed.stage
      : parsed;

  if (!isEditableStage(candidate)) {
    throw new Error("ミリしらソードのステージJSONとして読み込めません。");
  }

  return cloneEditableStage(candidate);
}

export function validateStageDraft(stage: EditableStage): string[] {
  const errors: string[] = [];

  if (
    !Number.isInteger(stage.width) ||
    !Number.isInteger(stage.height) ||
    stage.width < 1 ||
    stage.height < 1
  ) {
    errors.push("ステージの幅と高さが不正です。");
    return errors;
  }

  if (
    stage.tiles.length !== stage.height ||
    stage.tiles.some((row) => row.length !== stage.width)
  ) {
    errors.push("タイル配列の大きさがステージ寸法と一致していません。");
    return errors;
  }

  if (!isPointInsideStage(stage, stage.playerStart)) {
    errors.push("勇者の開始位置がステージ外です。");
  } else if (getTile(stage, stage.playerStart) === "wall") {
    errors.push("勇者の開始位置が壁に重なっています。");
  }

  if (stage.rooms.length === 0) {
    errors.push("カメラ範囲が1つもありません。");
    return errors;
  }

  const roomIds = new Set<string>();
  for (const room of stage.rooms) {
    if (roomIds.has(room.id)) {
      errors.push(`カメラID「${room.id}」が重複しています。`);
    }
    roomIds.add(room.id);

    if (!isRectInsideStage(stage, room.trigger)) {
      errors.push(`${room.name}のカメラ切替範囲がステージ外です。`);
    }
    if (!isRectInsideStage(stage, room.view)) {
      errors.push(`${room.name}の表示範囲がステージ外です。`);
    }
    if (Math.abs(room.view.width - room.view.height) > 0.0001) {
      errors.push(`${room.name}の表示範囲が正方形ではありません。`);
    }
    if (!rectContainsRect(room.view, room.trigger)) {
      errors.push(
        `${room.name}の表示範囲にカメラ切替範囲全体が収まっていません。`,
      );
    }
    if (!isRectInsideStage(stage, room.bounds)) {
      errors.push(`${room.name}の部屋範囲がステージ外です。`);
    }
    if (!isPointInsideStage(stage, room.puzzleAnchor)) {
      errors.push(`${room.name}のパズル位置がステージ外です。`);
    } else {
      if (getTile(stage, room.puzzleAnchor) === "wall") {
        errors.push(`${room.name}のパズル位置が壁に重なっています。`);
      }
      if (!containsTile(room.trigger, room.puzzleAnchor)) {
        errors.push(
          `${room.name}のパズル位置がカメラ切替範囲の外です。`,
        );
      }
    }
  }

  let uncoveredTiles = 0;
  let overlappingTiles = 0;
  stage.tiles.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (tile === "wall") return;

      const coveringRoomCount = stage.rooms.reduce(
        (count, room) =>
          count + (containsTile(room.trigger, { x, y }) ? 1 : 0),
        0,
      );
      if (coveringRoomCount === 0) uncoveredTiles += 1;
      if (coveringRoomCount > 1) overlappingTiles += 1;
    });
  });

  if (uncoveredTiles > 0) {
    errors.push(
      `カメラ切替範囲に含まれない床が${uncoveredTiles}マスあります。`,
    );
  }
  if (overlappingTiles > 0) {
    errors.push(
      `複数のカメラ切替範囲が重なる床が${overlappingTiles}マスあります。`,
    );
  }

  return errors;
}

function cloneEditableStage(source: EditableStage): EditableStage {
  return {
    ...source,
    tiles: source.tiles.map((row) => [...row]),
    playerStart: { ...source.playerStart },
    rooms: source.rooms.map(cloneRoom),
  };
}

function cloneRoom(room: RoomDefinition): RoomDefinition {
  return {
    ...room,
    bounds: { ...room.bounds },
    trigger: { ...room.trigger },
    view: { ...room.view },
    puzzleAnchor: { ...room.puzzleAnchor },
  };
}

function isEditableStage(value: unknown): value is EditableStage {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    Array.isArray(value.tiles) &&
    value.tiles.every(
      (row) => Array.isArray(row) && row.every(isTileKind),
    ) &&
    isGridPoint(value.playerStart) &&
    Array.isArray(value.rooms) &&
    value.rooms.every(isRoomDefinition)
  );
}

function isRoomDefinition(value: unknown): value is RoomDefinition {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isGridRect(value.bounds) &&
    isGridRect(value.trigger) &&
    isNumericGridRect(value.view) &&
    typeof value.transitionMs === "number" &&
    Number.isFinite(value.transitionMs) &&
    value.transitionMs >= 0 &&
    isGridPoint(value.puzzleAnchor)
  );
}

function isGridPoint(value: unknown): value is GridPoint {
  return (
    isRecord(value) &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y)
  );
}

function isGridRect(value: unknown): value is GridRect {
  return (
    isNumericGridRect(value) &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y) &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height)
  );
}

function isNumericGridRect(value: unknown): value is GridRect {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function isTileKind(value: unknown): value is TileKind {
  return value === "floor" || value === "grass" || value === "wall";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPointInsideStage(
  stage: EditableStage,
  point: GridPoint,
): boolean {
  return (
    point.x >= 0 &&
    point.x < stage.width &&
    point.y >= 0 &&
    point.y < stage.height
  );
}

function isRectInsideStage(
  stage: EditableStage,
  rect: GridRect,
): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= stage.width &&
    rect.y + rect.height <= stage.height
  );
}

function rectContainsRect(container: GridRect, target: GridRect): boolean {
  return (
    container.x <= target.x &&
    container.y <= target.y &&
    container.x + container.width >= target.x + target.width &&
    container.y + container.height >= target.y + target.height
  );
}

function getTile(
  stage: EditableStage,
  point: GridPoint,
): TileKind | undefined {
  return stage.tiles[point.y]?.[point.x];
}
