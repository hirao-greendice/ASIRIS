import {
  isWalkable,
  type GridPoint,
  type GridRect,
  type PuzzleDefinition,
  type RoomDefinition,
  type StageDefinition,
  type TileKind,
} from "../core/stageTypes";

const WORLD_WIDTH = 35;
const WORLD_HEIGHT = 12;
const CAMERA_OUTER_MARGIN_TILES = 0.5;

const roomBlueprints = [
  {
    id: "prototype-room-1",
    name: "ステージ1「林」",
    bounds: { x: 0, y: 0, width: 9, height: 10 },
    trigger: { x: 0, y: 0, width: 9, height: 10 },
  },
  {
    id: "prototype-room-2",
    name: "ステージ2「明」",
    bounds: { x: 8, y: 1, width: 10, height: 9 },
    trigger: { x: 9, y: 1, width: 9, height: 9 },
  },
  {
    id: "prototype-room-3",
    name: "ステージ3「仏」",
    bounds: { x: 17, y: 0, width: 9, height: 10 },
    trigger: { x: 18, y: 0, width: 8, height: 10 },
  },
  {
    id: "prototype-room-4",
    name: "ステージ4「休」",
    bounds: { x: 25, y: 0, width: 10, height: 11 },
    trigger: { x: 26, y: 0, width: 9, height: 11 },
  },
] as const;

const puzzles: readonly PuzzleDefinition[] = [
  {
    id: "forest",
    roomId: "prototype-room-1",
    number: 1,
    title: "林",
    answer: "林",
    hint: "「木」を2本斬り、木の文字を左右の枠へ",
    playerStart: { x: 2, y: 5 },
    playerFacing: "right",
    namedObjects: [
      {
        id: "tree-upper",
        name: "木",
        kind: "tree",
        position: { x: 2, y: 2 },
        letterSpawns: [{ x: 4, y: 3 }],
      },
      {
        id: "tree-lower",
        name: "木",
        kind: "tree",
        position: { x: 2, y: 7 },
        letterSpawns: [{ x: 4, y: 7 }],
      },
    ],
    targetSlots: [
      { id: "forest-left", position: { x: 5, y: 4 }, expected: "木" },
      { id: "forest-right", position: { x: 6, y: 4 }, expected: "木" },
    ],
    door: { position: { x: 8, y: 5 } },
  },
  {
    id: "bright",
    roomId: "prototype-room-2",
    number: 2,
    title: "明",
    answer: "明",
    hint: "「日」は左へ、「月」は右へ",
    playerStart: { x: 10, y: 5 },
    playerFacing: "right",
    namedObjects: [
      {
        id: "sun",
        name: "日",
        kind: "sun",
        position: { x: 10, y: 3 },
        letterSpawns: [{ x: 13, y: 3 }],
      },
      {
        id: "moon",
        name: "月",
        kind: "moon",
        position: { x: 10, y: 7 },
        letterSpawns: [{ x: 13, y: 7 }],
      },
    ],
    targetSlots: [
      { id: "bright-left", position: { x: 15, y: 4 }, expected: "日" },
      { id: "bright-right", position: { x: 16, y: 4 }, expected: "月" },
    ],
    door: { position: { x: 17, y: 5 } },
  },
  {
    id: "buddha",
    roomId: "prototype-room-3",
    number: 3,
    title: "仏",
    answer: "仏",
    hint: "名前は必ず、すべての文字になる",
    playerStart: { x: 19, y: 5 },
    playerFacing: "right",
    namedObjects: [
      {
        id: "slime-buddha",
        name: "スライム",
        kind: "slime",
        position: { x: 20, y: 4 },
        letterSpawns: [
          { x: 19, y: 2 },
          { x: 20, y: 2 },
          { x: 21, y: 3 },
          { x: 21, y: 7 },
        ],
      },
    ],
    targetSlots: [
      {
        id: "buddha-left",
        position: { x: 23, y: 4 },
        expected: "イ",
        transform: "person-radical",
      },
      { id: "buddha-right", position: { x: 24, y: 4 }, expected: "ム" },
    ],
    door: { position: { x: 25, y: 5 } },
    showAnswerSilhouette: true,
  },
  {
    id: "rest",
    roomId: "prototype-room-4",
    number: 4,
    title: "休",
    answer: "休",
    hint: "前のひらめきを、別の名前に組み合わせる",
    playerStart: { x: 27, y: 5 },
    playerFacing: "right",
    namedObjects: [
      {
        id: "tree-rest",
        name: "木",
        kind: "tree",
        position: { x: 28, y: 2 },
        letterSpawns: [{ x: 33, y: 2 }],
      },
      {
        id: "slime-rest",
        name: "スライム",
        kind: "slime",
        position: { x: 28, y: 6 },
        letterSpawns: [
          { x: 27, y: 8 },
          { x: 28, y: 8 },
          { x: 30, y: 7 },
          { x: 29, y: 8 },
        ],
      },
    ],
    targetSlots: [
      {
        id: "rest-left",
        position: { x: 32, y: 4 },
        expected: "イ",
        transform: "person-radical",
      },
      { id: "rest-right", position: { x: 33, y: 4 }, expected: "木" },
    ],
    door: { position: { x: 34, y: 5 } },
    showAnswerSilhouette: true,
  },
];

const tiles = createWorldTiles();
const rooms = roomBlueprints.map<RoomDefinition>((room, index) => ({
  ...room,
  view: createSquareCameraView(room.bounds),
  transitionMs: 240,
  puzzleAnchor: { ...puzzles[index].targetSlots[0].position },
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
    if (!isWalkable(stageToValidate, puzzle.playerStart)) {
      throw new Error(`${puzzle.id} has a player start on a wall.`);
    }
    if (isWalkable(stageToValidate, puzzle.door.position)) {
      throw new Error(`${puzzle.id} door must replace a wall tile.`);
    }

    const occupiedAtStart = new Set<string>();
    for (const object of puzzle.namedObjects) {
      const characters = Array.from(object.name);
      if (characters.length !== object.letterSpawns.length) {
        throw new Error(
          `${object.id} needs one spawn tile for every character in its name.`,
        );
      }
      validateFreePoint(stageToValidate, object.position, object.id);
      addUniquePoint(occupiedAtStart, object.position, object.id);

      object.letterSpawns.forEach((point, index) => {
        validateFreePoint(stageToValidate, point, `${object.id}[${index}]`);
        addUniquePoint(occupiedAtStart, point, `${object.id}[${index}]`);
      });
    }

    for (const slot of puzzle.targetSlots) {
      validateFreePoint(stageToValidate, slot.position, slot.id);
    }

    const availableCharacters = puzzle.namedObjects.flatMap((object) =>
      Array.from(object.name)
    );
    for (const slot of puzzle.targetSlots) {
      const characterIndex = availableCharacters.indexOf(slot.expected);
      if (characterIndex < 0) {
        throw new Error(`${puzzle.id} cannot produce ${slot.expected}.`);
      }
      availableCharacters.splice(characterIndex, 1);
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
