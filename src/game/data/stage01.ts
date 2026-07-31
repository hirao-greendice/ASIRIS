import {
  containsTile,
  isWalkable,
  type GridPoint,
  type GridRect,
  type RoomDefinition,
  type StageDefinition,
  type TileKind,
} from "../core/stageTypes";

const WORLD_SIZE = 100;
const CAMERA_OUTER_MARGIN_TILES = 0.5;

/*
 * Wall coordinates divide the 100 x 100 world into 8 x 8 rooms.
 * Changing these values changes room sizes without rewriting a 100-line map.
 * Adjacent rooms share the wall at each coordinate.
 */
const X_WALLS = [0, 9, 22, 33, 48, 58, 72, 84, 99] as const;
const Y_WALLS = [0, 12, 21, 35, 46, 61, 71, 84, 99] as const;

/*
 * Every row of rooms is connected horizontally. These additional doorway
 * columns connect neighboring rows while leaving a maze-like overall route.
 */
const VERTICAL_CONNECTION_COLUMNS = [
  [1, 6],
  [3, 7],
  [0, 5],
  [2, 6],
  [1, 4],
  [3, 7],
  [0, 5],
] as const;

const CARDINAL_OFFSETS: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

validateWallCoordinates(X_WALLS, "X");
validateWallCoordinates(Y_WALLS, "Y");

const tiles = createWorldTiles();
drawSharedWalls(tiles);
carveDoorways(tiles);

const rooms = createRooms();

const stage: StageDefinition = {
  id: "stage-01",
  name: "可変小部屋ワールド",
  width: WORLD_SIZE,
  height: WORLD_SIZE,
  tiles,
  playerStart: { ...rooms[0].puzzleAnchor },
  rooms,
  // Room definitions remain the single source of truth for camera areas.
  cameraAreas: rooms,
};

validateStage(stage);

export const stage01 = stage;

function createWorldTiles(): TileKind[][] {
  return Array.from(
    { length: WORLD_SIZE },
    () => Array<TileKind>(WORLD_SIZE).fill("floor"),
  );
}

function drawSharedWalls(worldTiles: TileKind[][]): void {
  for (const wallX of X_WALLS) {
    for (let y = 0; y < WORLD_SIZE; y += 1) {
      worldTiles[y][wallX] = "wall";
    }
  }

  for (const wallY of Y_WALLS) {
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      worldTiles[wallY][x] = "wall";
    }
  }
}

function carveDoorways(worldTiles: TileKind[][]): void {
  const rowCount = Y_WALLS.length - 1;
  const columnCount = X_WALLS.length - 1;

  // Join every pair of horizontally adjacent rooms.
  for (let row = 0; row < rowCount; row += 1) {
    const topWall = Y_WALLS[row];
    const bottomWall = Y_WALLS[row + 1];

    for (let column = 0; column < columnCount - 1; column += 1) {
      const wallX = X_WALLS[column + 1];
      const doorY = pickInteriorCoordinate(
        topWall,
        bottomWall,
        row * 3 + column * 2,
      );
      worldTiles[doorY][wallX] = "floor";
    }
  }

  // Join neighboring room rows at two deliberately separated points.
  VERTICAL_CONNECTION_COLUMNS.forEach((columns, row) => {
    const wallY = Y_WALLS[row + 1];

    for (const column of columns) {
      const leftWall = X_WALLS[column];
      const rightWall = X_WALLS[column + 1];
      const doorX = pickInteriorCoordinate(
        leftWall,
        rightWall,
        row * 4 + column * 3,
      );
      worldTiles[wallY][doorX] = "floor";
    }
  });
}

function createRooms(): RoomDefinition[] {
  const rooms: RoomDefinition[] = [];

  for (let row = 0; row < Y_WALLS.length - 1; row += 1) {
    for (let column = 0; column < X_WALLS.length - 1; column += 1) {
      const leftWall = X_WALLS[column];
      const rightWall = X_WALLS[column + 1];
      const topWall = Y_WALLS[row];
      const bottomWall = Y_WALLS[row + 1];
      const bounds: GridRect = {
        x: leftWall,
        y: topWall,
        width: rightWall - leftWall + 1,
        height: bottomWall - topWall + 1,
      };

      rooms.push({
        id: `room-${String(row + 1).padStart(2, "0")}-${String(column + 1).padStart(2, "0")}`,
        name: `第${row + 1}行・第${column + 1}列の部屋`,
        bounds,
        trigger: {
          x: leftWall,
          y: topWall,
          width: rightWall - leftWall,
          height: bottomWall - topWall,
        },
        view: createSquareCameraView(bounds),
        transitionMs: 260,
        puzzleAnchor: {
          x: Math.floor((leftWall + rightWall) / 2),
          y: Math.floor((topWall + bottomWall) / 2),
        },
      });
    }
  }

  return rooms;
}

function createSquareCameraView(roomBounds: GridRect): GridRect {
  const size =
    Math.max(roomBounds.width, roomBounds.height) +
    CAMERA_OUTER_MARGIN_TILES * 2;
  const centerX = roomBounds.x + roomBounds.width / 2;
  const centerY = roomBounds.y + roomBounds.height / 2;

  return {
    x: clamp(centerX - size / 2, 0, WORLD_SIZE - size),
    y: clamp(centerY - size / 2, 0, WORLD_SIZE - size),
    width: size,
    height: size,
  };
}

function pickInteriorCoordinate(
  startWall: number,
  endWall: number,
  seed: number,
): number {
  const interiorSize = endWall - startWall - 1;
  if (interiorSize < 1) {
    throw new Error("Rooms need at least one interior tile for a doorway.");
  }

  return startWall + 1 + seed % interiorSize;
}

function validateWallCoordinates(
  coordinates: readonly number[],
  axis: string,
): void {
  if (
    coordinates[0] !== 0 ||
    coordinates[coordinates.length - 1] !== WORLD_SIZE - 1
  ) {
    throw new Error(
      `${axis} wall coordinates must start at 0 and end at ${WORLD_SIZE - 1}.`,
    );
  }

  for (let index = 1; index < coordinates.length; index += 1) {
    if (coordinates[index] <= coordinates[index - 1]) {
      throw new Error(`${axis} wall coordinates must be strictly increasing.`);
    }
  }
}

function validateStage(stageToValidate: StageDefinition): void {
  if (
    stageToValidate.tiles.length !== stageToValidate.height ||
    stageToValidate.tiles.some(
      (row) => row.length !== stageToValidate.width,
    )
  ) {
    throw new Error("Stage tile dimensions do not match the stage size.");
  }

  for (const room of stageToValidate.rooms) {
    if (!isWalkable(stageToValidate, room.puzzleAnchor)) {
      throw new Error(`${room.id} has a puzzle anchor on a wall.`);
    }
    if (
      Math.abs(room.view.width - room.view.height) > 0.0001 ||
      !rectContainsRect(room.view, room.bounds)
    ) {
      throw new Error(`${room.id} camera must squarely contain the room.`);
    }
  }

  const roomSizes = new Set(
    stageToValidate.rooms.map(
      (room) => `${room.bounds.width}x${room.bounds.height}`,
    ),
  );
  const cameraSizes = new Set(
    stageToValidate.cameraAreas.map((area) => area.view.width),
  );
  if (roomSizes.size < 4 || cameraSizes.size < 4) {
    throw new Error("Stage rooms and camera views need meaningful size variety.");
  }

  stageToValidate.tiles.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (tile === "wall") return;

      const coveringRooms = stageToValidate.rooms.filter((room) =>
        containsTile(room.trigger, { x, y }),
      );
      if (coveringRooms.length !== 1) {
        throw new Error(
          `Walkable tile (${x}, ${y}) must belong to exactly one room.`,
        );
      }
    });
  });

  validateAllWalkableTilesAreConnected(stageToValidate);
}

function validateAllWalkableTilesAreConnected(
  stageToValidate: StageDefinition,
): void {
  const visited = Array.from(
    { length: stageToValidate.height },
    () => Array<boolean>(stageToValidate.width).fill(false),
  );
  const queue: GridPoint[] = [{ ...stageToValidate.playerStart }];
  visited[stageToValidate.playerStart.y][stageToValidate.playerStart.x] = true;

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const point = queue[queueIndex];

    for (const offset of CARDINAL_OFFSETS) {
      const next = { x: point.x + offset.x, y: point.y + offset.y };
      if (
        isWalkable(stageToValidate, next) &&
        !visited[next.y][next.x]
      ) {
        visited[next.y][next.x] = true;
        queue.push(next);
      }
    }
  }

  let walkableTileCount = 0;
  stageToValidate.tiles.forEach((row) => {
    row.forEach((tile) => {
      if (tile !== "wall") walkableTileCount += 1;
    });
  });

  if (queue.length !== walkableTileCount) {
    throw new Error(
      `Stage has ${walkableTileCount - queue.length} unreachable floor tiles.`,
    );
  }
}

function rectContainsRect(container: GridRect, target: GridRect): boolean {
  return (
    container.x <= target.x &&
    container.y <= target.y &&
    container.x + container.width >= target.x + target.width &&
    container.y + container.height >= target.y + target.height
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
