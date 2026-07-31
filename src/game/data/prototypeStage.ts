import {
  isWalkable,
  type GridPoint,
  type GridRect,
  type PuzzleDefinition,
  type RoomDefinition,
  type StageDefinition,
  type SwordMode,
  type TileKind,
} from "../core/stageTypes";

const WORLD_WIDTH = 38;
const WORLD_HEIGHT = 12;
const CAMERA_OUTER_MARGIN_TILES = 0.5;

const roomBlueprints = [
  {
    id: "prototype-room-1",
    name: "ステージ1「MOON」",
    bounds: { x: 0, y: 0, width: 9, height: 10 },
    trigger: { x: 0, y: 0, width: 9, height: 10 },
  },
  {
    id: "prototype-room-2",
    name: "ステージ2「仏」",
    bounds: { x: 8, y: 1, width: 10, height: 9 },
    trigger: { x: 9, y: 1, width: 9, height: 9 },
  },
  {
    id: "prototype-room-3",
    name: "ステージ3「休」",
    bounds: { x: 17, y: 0, width: 12, height: 10 },
    trigger: { x: 18, y: 0, width: 11, height: 10 },
  },
  {
    id: "prototype-room-4",
    name: "ステージ4「SUNDAY」",
    bounds: { x: 28, y: 0, width: 10, height: 11 },
    trigger: { x: 29, y: 0, width: 9, height: 11 },
  },
] as const;

const puzzles: readonly PuzzleDefinition[] = [
  {
    id: "moon-pressure",
    roomId: "prototype-room-1",
    number: 1,
    title: "MOON",
    answer: "MOON",
    hint: "英語剣へ切り替え、月の名前を右の壁へ押しつける",
    playerStart: { x: 1, y: 5 },
    playerFacing: "up",
    namedObjects: [
      {
        id: "moon",
        names: { kana: "つき", english: "MOON" },
        kind: "moon",
        position: { x: 2, y: 4 },
      },
    ],
    fusionRules: [
      { components: ["M", "O", "O", "N"], result: "MOON" },
    ],
    goal: { position: { x: 5, y: 4 }, result: "MOON" },
    door: { position: { x: 8, y: 5 } },
  },
  {
    id: "buddha-pressure",
    roomId: "prototype-room-2",
    number: 2,
    title: "仏",
    answer: "仏",
    hint: "かな剣で斬り、ス・ラを退けて「イム」を壁へ",
    playerStart: { x: 10, y: 5 },
    playerFacing: "up",
    namedObjects: [
      {
        id: "slime-buddha",
        names: { kana: "スライム", english: "SLIME" },
        kind: "slime",
        position: { x: 11, y: 4 },
      },
    ],
    fusionRules: [
      { components: ["イ", "ム"], result: "仏" },
    ],
    goal: { position: { x: 15, y: 4 }, result: "仏" },
    door: { position: { x: 17, y: 5 } },
  },
  {
    id: "rest-pressure",
    roomId: "prototype-room-3",
    number: 3,
    title: "休",
    answer: "休",
    hint: "「イ」と「木」を右端へ集め、壁へ押しつける",
    playerStart: { x: 19, y: 5 },
    playerFacing: "right",
    namedObjects: [
      {
        id: "tree-rest",
        names: { kana: "木", english: "TREE" },
        kind: "tree",
        position: { x: 23, y: 2 },
      },
      {
        id: "slime-rest",
        names: { kana: "スライム", english: "SLIME" },
        kind: "slime",
        position: { x: 19, y: 7 },
      },
    ],
    fusionRules: [
      { components: ["イ", "木"], result: "休" },
    ],
    goal: { position: { x: 27, y: 4 }, result: "休" },
    door: { position: { x: 28, y: 5 } },
  },
  {
    id: "sunday-pressure",
    roomId: "prototype-room-4",
    number: 4,
    title: "SUNDAY",
    answer: "SUNDAY",
    hint: "英語剣で SUN と DAY を一直線にし、まとめて圧着する",
    playerStart: { x: 30, y: 6 },
    playerFacing: "up",
    namedObjects: [
      {
        id: "sun-sunday",
        names: { kana: "ひ", english: "SUN" },
        kind: "sun",
        position: { x: 30, y: 4 },
      },
      {
        id: "day-sunday",
        names: { kana: "ようび", english: "DAY" },
        kind: "calendar",
        position: { x: 33, y: 4 },
      },
    ],
    fusionRules: [
      {
        components: ["S", "U", "N", "D", "A", "Y"],
        result: "SUNDAY",
      },
    ],
    goal: { position: { x: 35, y: 4 }, result: "SUNDAY" },
    door: { position: { x: 37, y: 5 } },
  },
];

const tiles = createWorldTiles();
const rooms = roomBlueprints.map<RoomDefinition>((room, index) => ({
  ...room,
  view: createSquareCameraView(room.bounds),
  transitionMs: 240,
  puzzleAnchor: { ...puzzles[index].goal.position },
}));

const stage: StageDefinition = {
  id: "core-gimmick-prototype",
  name: "コアギミック試作",
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  tiles,
  playerStart: { ...puzzles[0].playerStart },
  rooms,
  cameraAreas: rooms,
  puzzles,
};

validatePrototypeStage(stage);

export const prototypeStage = stage;

function createWorldTiles(): TileKind[][] {
  const worldTiles = Array.from(
    { length: WORLD_HEIGHT },
    () => Array<TileKind>(WORLD_WIDTH).fill("wall"),
  );

  for (const room of roomBlueprints) {
    const right = room.bounds.x + room.bounds.width - 1;
    const bottom = room.bounds.y + room.bounds.height - 1;
    for (let y = room.bounds.y + 1; y < bottom; y += 1) {
      for (let x = room.bounds.x + 1; x < right; x += 1) {
        worldTiles[y][x] = "floor";
      }
    }
  }

  // Each fusion lane ends in a visible wall. Components only merge when the
  // player compresses the complete sequence against one of these stops.
  worldTiles[4][6] = "wall";
  worldTiles[4][16] = "wall";
  worldTiles[4][36] = "wall";

  return worldTiles;
}

function createSquareCameraView(bounds: GridRect): GridRect {
  const size =
    Math.max(bounds.width, bounds.height) +
    CAMERA_OUTER_MARGIN_TILES * 2;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    x: clamp(centerX - size / 2, 0, WORLD_WIDTH - size),
    y: clamp(centerY - size / 2, 0, WORLD_HEIGHT - size),
    width: size,
    height: size,
  };
}

function validatePrototypeStage(stageToValidate: StageDefinition): void {
  const puzzleDefinitions = stageToValidate.puzzles;
  if (!puzzleDefinitions || puzzleDefinitions.length !== 4) {
    throw new Error("The core prototype must contain exactly four puzzles.");
  }

  const roomIds = new Set(stageToValidate.rooms.map((room) => room.id));

  for (const puzzle of puzzleDefinitions) {
    if (!roomIds.has(puzzle.roomId)) {
      throw new Error(`${puzzle.id} refers to an unknown room.`);
    }
    validateFreePoint(stageToValidate, puzzle.playerStart, puzzle.id);
    validateFreePoint(
      stageToValidate,
      puzzle.goal.position,
      `${puzzle.id} goal`,
    );
    if (isWalkable(stageToValidate, puzzle.door.position)) {
      throw new Error(`${puzzle.id} door must replace a wall tile.`);
    }
    if (
      puzzle.answer !== puzzle.goal.result ||
      !puzzle.fusionRules.some(
        (rule) => rule.result === puzzle.goal.result,
      )
    ) {
      throw new Error(`${puzzle.id} needs a fusion rule for its answer.`);
    }

    const occupiedObjects = new Set<string>();
    for (const object of puzzle.namedObjects) {
      validateFreePoint(stageToValidate, object.position, object.id);
      addUniquePoint(occupiedObjects, object.position, object.id);

      for (const mode of ["kana", "english"] as const satisfies readonly SwordMode[]) {
        const characters = Array.from(object.names[mode]);
        if (characters.length === 0) {
          throw new Error(`${object.id} has an empty ${mode} name.`);
        }
        characters.forEach((_, index) => {
          validateFreePoint(
            stageToValidate,
            {
              x: object.position.x + index,
              y: object.position.y,
            },
            `${object.id}.${mode}[${index}]`,
          );
        });
      }
    }

    const wallAfterGoal = {
      x: puzzle.goal.position.x + 1,
      y: puzzle.goal.position.y,
    };
    if (isWalkable(stageToValidate, wallAfterGoal)) {
      throw new Error(`${puzzle.id} goal needs a pressure wall on its right.`);
    }
  }
}

function validateFreePoint(
  stageToValidate: StageDefinition,
  point: GridPoint,
  label: string,
): void {
  if (!isWalkable(stageToValidate, point)) {
    throw new Error(`${label} must be placed on a floor tile.`);
  }
}

function addUniquePoint(
  occupied: Set<string>,
  point: GridPoint,
  label: string,
): void {
  const key = pointKey(point);
  if (occupied.has(key)) {
    throw new Error(`${label} overlaps another starting entity.`);
  }
  occupied.add(key);
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
