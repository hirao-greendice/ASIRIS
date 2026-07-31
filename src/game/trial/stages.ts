import type { HeroDirection } from "../assets/GameAssets";
import type { GridPoint, GridRect } from "../core/stageTypes";
import type {
  DoorDefinition,
  FusionWallDefinition,
  NamedEntityDefinition,
  NamedEntityKind,
  SightEnemyDefinition,
  SwitchDefinition,
  TrialAction,
  TrialRoomDefinition,
  TrialStageDefinition,
  TrialTerrain,
} from "./types";

interface EntityCatalogEntry {
  kind: NamedEntityKind;
  jpName: string;
  enName: string;
}

interface StageSpec {
  id: string;
  title: string;
  hint: string;
  width: number;
  height: number;
  mapRows: readonly string[];
  playerFacing: HeroDirection;
  chaserSymbols?: readonly string[];
  unknownSymbols?: readonly string[];
  extraSwitches?: readonly GridPoint[];
  fusion?: {
    inputDirection: HeroDirection;
    recipe: readonly string[];
    result: string;
    conditionId: string;
    createsLetter?: boolean;
  };
  doorConditionIds?: readonly string[];
  doorIsGoal?: boolean;
  alwaysShowTargetName?: boolean;
  horizontalBlockStopsChaser?: boolean;
  entrySide?: "top" | "bottom";
  exitSide?: "right" | "top" | "bottom";
  solutionActions: readonly TrialAction[];
}

const ENTITY_CATALOG: Readonly<Record<string, EntityCatalogEntry>> = {
  T: { kind: "tree", jpName: "き", enName: "TREE" },
  L: { kind: "slime", jpName: "すらいむ", enName: "SLIME" },
  H: { kind: "snake", jpName: "へび", enName: "SNAKE" },
  R: { kind: "stone", jpName: "いし", enName: "STONE" },
  Q: { kind: "shield", jpName: "たて", enName: "SHIELD" },
  C: { kind: "crown", jpName: "おうかん", enName: "CROWN" },
  K: { kind: "knight", jpName: "きし", enName: "KNIGHT" },
  Y: { kind: "key", jpName: "かぎ", enName: "KEY" },
  B: { kind: "bat", jpName: "こうもり", enName: "BAT" },
  W: { kind: "fence", jpName: "へい", enName: "WALL" },
  M: { kind: "mimic", jpName: "みみっく", enName: "MIMIC" },
  F: { kind: "fire", jpName: "ひ", enName: "FIRE" },
};

const SIGHT_DIRECTIONS: Readonly<Record<string, HeroDirection>> = {
  ">": "right",
  "<": "left",
  "^": "up",
  v: "down",
};

const stageSpecs: readonly StageSpec[] = [
  {
    id: "tree-single-letter",
    title: "きの一字",
    hint: "まずは一文字。「き」をスイッチまで押す。",
    width: 7,
    height: 5,
    mapRows: [
      "#######",
      "#.....#",
      "#P.T.D#",
      "###s###",
      "#######",
    ],
    playerFacing: "down",
    doorIsGoal: true,
    solutionActions: [
      "right",
      "slash-jp",
      "up",
      "right",
      "down",
      "right",
      "right",
    ],
  },
  {
    id: "snake-line",
    title: "へびの ならべかた",
    hint: "短い名前なら、届く。長い名前なら、つかえる？",
    width: 7,
    height: 7,
    mapRows: [
      "#######",
      "#..P..#",
      "#..H..#",
      "#..s..#",
      "#....D#",
      "#....G#",
      "#######",
    ],
    playerFacing: "down",
    solutionActions: ["slash-jp", "right", "right", ...repeat("down", 4)],
  },
  {
    id: "snake-two-jobs",
    title: "ヘビの半分",
    hint: "同じ名前の二文字を、スイッチと溝へ分ける。",
    width: 8,
    height: 7,
    mapRows: [
      "########",
      "#......#",
      "#P.H...#",
      "###.#≈##",
      "###.#.##",
      "###s#D##",
      "########",
    ],
    playerFacing: "down",
    doorIsGoal: true,
    exitSide: "bottom",
    solutionActions: [
      "right",
      "slash-jp",
      "up",
      "right",
      ...repeat("down", 3),
      ...repeat("up", 2),
      "right",
      "up",
      "right",
      ...repeat("down", 4),
    ],
  },
  {
    id: "slime-buddha",
    title: "いむから仏",
    hint: "すとらをよけ、いとむを壁へ押しつける。",
    width: 10,
    height: 7,
    mapRows: [
      "##########",
      "#........#",
      "#PL...X..#",
      "#........#",
      "#....s.DG#",
      "#........#",
      "##########",
    ],
    playerFacing: "right",
    fusion: {
      inputDirection: "right",
      recipe: ["い", "む"],
      result: "仏",
      conditionId: "fusion-buddha",
      createsLetter: true,
    },
    solutionActions: [
      "slash-jp",
      "up",
      "right",
      "down",
      "up",
      "right",
      "down",
      "right",
      "up",
      "right",
      "down",
      "down",
      "right",
      "right",
      "down",
      "right",
    ],
  },
  {
    id: "stone-space",
    title: "石の余白",
    hint: "出せることと、動かせることは同じではない。",
    width: 10,
    height: 6,
    mapRows: [
      "##########",
      "#.......G#",
      "#.......D#",
      "#PR...s..#",
      "#........#",
      "##########",
    ],
    playerFacing: "right",
    entrySide: "bottom",
    exitSide: "top",
    solutionActions: [
      "slash-jp",
      "down",
      "right",
      "right",
      "up",
      "down",
      "left",
      "left",
      "up",
      ...repeat("right", 4),
      "down",
      ...repeat("right", 3),
      ...repeat("up", 3),
    ],
  },
  {
    id: "shield-is-shield",
    title: "盾は盾",
    hint: "物では防げない。文字なら防げる。",
    width: 9,
    height: 6,
    mapRows: [
      "#########",
      "#.....P.#",
      "#>..s.Q.#",
      "######.D#",
      "#######G#",
      "#########",
    ],
    playerFacing: "down",
    solutionActions: [
      "slash-jp",
      "right",
      "down",
      "left",
      "left",
      "right",
      "right",
      "down",
      "down",
    ],
  },
  {
    id: "five-letter-screen",
    title: "五文字の幕",
    hint: "長い名前を、三本の視線へ横切らせる。",
    width: 9,
    height: 7,
    mapRows: [
      "#########",
      "#.v.v.v.#",
      "#.......#",
      "#PC.....#",
      "#.......#",
      "#......G#",
      "#########",
    ],
    playerFacing: "right",
    solutionActions: ["slash-en", "down", "down", ...repeat("right", 6)],
  },
  {
    id: "six-letter-rampart",
    title: "六文字の城壁",
    hint: "一歩で向きを決め、六文字を縦の城壁にする。",
    width: 9,
    height: 10,
    mapRows: [
      "#########",
      "#.....P.#",
      "#.......#",
      "#.....K.#",
      "#>......#",
      "#>.....D#",
      "#>......#",
      "#.......#",
      "#.....s.#",
      "#########",
    ],
    playerFacing: "up",
    doorIsGoal: true,
    solutionActions: [
      "down",
      "slash-en",
      "right",
      ...repeat("down", 3),
    ],
  },
  {
    id: "cross-printing",
    title: "交差印刷",
    hint: "交点の一文字を先に剥がし、残りの場所へ。",
    width: 10,
    height: 9,
    mapRows: [
      "##########",
      "#......DG#",
      "#...C....#",
      "#...s....#",
      "#PY.s#...#",
      "#...ss...#",
      "#...s....#",
      "#........#",
      "##########",
    ],
    playerFacing: "right",
    extraSwitches: [{ x: 4, y: 2 }],
    solutionActions: [
      "slash-en",
      "up",
      ...repeat("right", 3),
      "down",
      "up",
      ...repeat("left", 3),
      ...repeat("down", 2),
      ...repeat("right", 3),
      ...repeat("left", 3),
      ...repeat("up", 4),
      ...repeat("right", 3),
      "down",
      "slash-en",
      ...repeat("right", 4),
    ],
  },
  {
    id: "wait-then-cut",
    title: "一歩待ってから斬れ",
    hint: "敵の位置が、文字列の印刷開始地点になる。",
    width: 9,
    height: 7,
    mapRows: [
      "#########",
      "#..s#...#",
      "#..s#...#",
      "#..sB#..#",
      "#...P.DG#",
      "#.......#",
      "#########",
    ],
    playerFacing: "up",
    chaserSymbols: ["B"],
    entrySide: "bottom",
    solutionActions: ["left", "up", "slash-en", ...repeat("right", 4)],
  },
  {
    id: "invisible-fence",
    title: "見えない柵",
    hint: "長い文字列で、敵の次の一歩を変える。",
    width: 10,
    height: 9,
    mapRows: [
      "##########",
      "##.....K.#",
      "##.......#",
      "##.......#",
      "##W......#",
      "#.Pss....#",
      "#D.......#",
      "#G.^######",
      "##########",
    ],
    playerFacing: "up",
    chaserSymbols: ["K"],
    entrySide: "bottom",
    exitSide: "bottom",
    solutionActions: [
      "slash-en",
      "left",
      "right",
      ...repeat("slash-jp", 6),
      "left",
      "down",
      "down",
    ],
  },
  {
    id: "know-the-fifth-letter",
    title: "五文字目を知っている",
    hint: "失敗のあとにも、知った名前だけは残る。",
    width: 10,
    height: 8,
    mapRows: [
      "##########",
      "#DGs######",
      "#......<.#",
      "#..s.....#",
      "#......<.#",
      "#...M....#",
      "#...P....#",
      "##########",
    ],
    playerFacing: "up",
    chaserSymbols: ["M"],
    unknownSymbols: ["M"],
    entrySide: "bottom",
    exitSide: "top",
    solutionActions: [
      "slash-en",
      "reset",
      "left",
      "up",
      "slash-en",
      "left",
      "left",
      ...repeat("up", 5),
      "right",
    ],
  },
  {
    id: "carve-flame",
    title: "炎を刻む",
    hint: "正しい二文字だけが、壁の前で一つになる。",
    width: 9,
    height: 7,
    mapRows: [
      "#########",
      "#...X...#",
      "#.......#",
      "#.......#",
      "#.F...F.#",
      "#..P..DG#",
      "#########",
    ],
    playerFacing: "up",
    entrySide: "bottom",
    exitSide: "bottom",
    fusion: {
      inputDirection: "up",
      recipe: ["ひ", "ひ"],
      result: "炎",
      conditionId: "fusion-fire",
    },
    doorConditionIds: ["fusion-fire"],
    solutionActions: [
      "left",
      "up",
      "slash-jp",
      "left",
      "up",
      "right",
      "right",
      "down",
      "right",
      "up",
      "up",
      "right",
      "right",
      "down",
      "slash-jp",
      "right",
      "down",
      "left",
      "left",
      "down",
      "left",
      "up",
      "up",
      "down",
      "down",
      "right",
      "right",
      "right",
    ],
  },
  {
    id: "meeting-knight-rampart",
    title: "六文字の城壁",
    hint: "騎士を誘導し、名前の長さで三本の視線と扉を攻略する。",
    width: 15,
    height: 15,
    mapRows: [
      "###############",
      "#.............#",
      "#.###.....###.#",
      "#.#.........#.#",
      "#.#.........#.#",
      "#.#.........#.#",
      "#.#.P.......#.#",
      "#.#.........#.#",
      "#.............#",
      "#>............#",
      "#>.........D..#",
      "#>K...........#",
      "#######.#######",
      "#######S#######",
      "###############",
    ],
    playerFacing: "down",
    chaserSymbols: ["K"],
    doorIsGoal: true,
    alwaysShowTargetName: true,
    horizontalBlockStopsChaser: true,
    solutionActions: [
      "up",
      "up",
      "down",
      "down",
      "right",
      "right",
      "right",
      "down",
      "slash-en",
      "right",
      "down",
      "down",
      "down",
      "right",
      "right",
      "right",
    ],
  },
];

export const trialRooms: readonly TrialStageDefinition[] =
  stageSpecs.map(createStage);

export const trialStages: readonly TrialStageDefinition[] = [
  createConnectedStage(trialRooms),
];

export const defaultTrialStageIndex = 0;

export function validateTrialStages(
  stages: readonly TrialStageDefinition[] = trialStages,
): void {
  if (stages.length !== 1) {
    throw new Error(`Expected one connected world, received ${stages.length}.`);
  }

  for (const stage of stages) {
    if (stage.mapRows.length !== stage.height) {
      throw new Error(`${stage.id}: map height is inconsistent.`);
    }
    stage.mapRows.forEach((row, index) => {
      if (row.length !== stage.width) {
        throw new Error(
          `${stage.id}: row ${index + 1} is ${row.length}, expected ${stage.width}.`,
        );
      }
    });
    if (stage.goals.length !== 1) {
      throw new Error(`${stage.id}: goal is missing.`);
    }
    if (stage.rooms.length !== 14) {
      throw new Error(
        `${stage.id}: expected 14 connected rooms, received ${stage.rooms.length}.`,
      );
    }
    if (stage.cameraAreas.length !== stage.rooms.length) {
      throw new Error(`${stage.id}: every room needs a camera area.`);
    }
  }

  const meeting = stages[0].rooms.find(
    (room) => room.id === "meeting-knight-rampart",
  );
  if (
    !meeting ||
    meeting.bounds.width !== 15 ||
    meeting.bounds.height !== 15
  ) {
    throw new Error("The 15 by 15 meeting stage is missing.");
  }
  if (!stages[0].rooms.some((room) => room.id === "slime-buddha")) {
    throw new Error("The slime-to-Buddha room is missing.");
  }
}

validateTrialStages();

function createStage(spec: StageSpec, index: number): TrialStageDefinition {
  const height = spec.height;
  const width = spec.width;
  if (width === 0) throw new Error(`${spec.id}: map is empty.`);
  if (spec.mapRows.length !== height) {
    throw new Error(
      `${spec.id}: map has ${spec.mapRows.length} rows, expected ${height}.`,
    );
  }
  spec.mapRows.forEach((row, rowIndex) => {
    if (row.length !== width) {
      throw new Error(
        `${spec.id}: row ${rowIndex + 1} has a different width.`,
      );
    }
  });

  let playerStart: GridPoint | undefined;
  const terrain: TrialTerrain[][] = [];
  const objects: NamedEntityDefinition[] = [];
  const sightEnemies: SightEnemyDefinition[] = [];
  const switches: SwitchDefinition[] = [];
  const doorPositions: GridPoint[] = [];
  const goals: GridPoint[] = [];
  const fusionPositions: GridPoint[] = [];
  const pitPositions: GridPoint[] = [];
  const chasers = new Set(spec.chaserSymbols ?? []);
  const unknowns = new Set(spec.unknownSymbols ?? []);

  spec.mapRows.forEach((row, y) => {
    const terrainRow: TrialTerrain[] = [];
    Array.from(row).forEach((symbol, x) => {
      const position = { x, y };
      terrainRow.push(
        symbol === "#" || symbol === "X"
          ? "wall"
          : symbol === "≈"
            ? "pit"
            : "floor",
      );

      if (symbol === "P") {
        if (playerStart) throw new Error(`${spec.id}: multiple players.`);
        playerStart = position;
      } else if (ENTITY_CATALOG[symbol]) {
        const catalog = ENTITY_CATALOG[symbol];
        objects.push({
          id: `${spec.id}-${symbol}-${x}-${y}`,
          symbol,
          kind: catalog.kind,
          position,
          jpName: catalog.jpName,
          enName: catalog.enName,
          slashable: true,
          isUnknown: unknowns.has(symbol),
          behavior: chasers.has(symbol) ? "chaser" : "static",
        });
      } else if (SIGHT_DIRECTIONS[symbol]) {
        sightEnemies.push({
          id: `${spec.id}-sight-${x}-${y}`,
          position,
          direction: SIGHT_DIRECTIONS[symbol],
        });
      } else if (symbol === "s" || symbol === "S") {
        switches.push(createSwitch(spec.id, position));
      } else if (symbol === "D") {
        doorPositions.push(position);
      } else if (symbol === "G") {
        goals.push(position);
      } else if (symbol === "X") {
        fusionPositions.push(position);
      } else if (symbol === "≈") {
        pitPositions.push(position);
      } else if (symbol !== "." && symbol !== "#") {
        throw new Error(`${spec.id}: unsupported map symbol "${symbol}".`);
      }
    });
    terrain.push(terrainRow);
  });

  for (const position of spec.extraSwitches ?? []) {
    if (switches.some((entry) => pointsEqual(entry.position, position))) {
      throw new Error(`${spec.id}: duplicate switch at ${pointKey(position)}.`);
    }
    switches.push(createSwitch(spec.id, position));
  }

  if (!playerStart) throw new Error(`${spec.id}: player is missing.`);

  const fusionWalls: FusionWallDefinition[] = fusionPositions.map(
    (position, fusionIndex) => {
      if (!spec.fusion) {
        throw new Error(`${spec.id}: fusion wall rule is missing.`);
      }
      return {
        id: `${spec.id}-fusion-wall-${fusionIndex}`,
        position,
        ...spec.fusion,
      };
    },
  );
  if (spec.fusion && fusionWalls.length === 0) {
    throw new Error(`${spec.id}: fusion rule has no wall.`);
  }

  const requiredConditionIds = spec.doorConditionIds ?? [];
  const doors: DoorDefinition[] = doorPositions.map((position, doorIndex) => ({
    id: `${spec.id}-door-${doorIndex}`,
    position,
    requiredSwitchIds:
      requiredConditionIds.length > 0
        ? []
        : switches.map((entry) => entry.id),
    requiredConditionIds,
  }));
  if (spec.doorIsGoal) {
    goals.push(...doorPositions.map((position) => ({ ...position })));
  }

  const pits = pitPositions.map((position, pitIndex) => ({
    id: `${spec.id}-pit-${pitIndex}`,
    position,
  }));

  return {
    id: spec.id,
    number: index + 1,
    title: spec.title,
    hint: spec.hint,
    width,
    height,
    mapRows: spec.mapRows,
    terrain,
    playerStart,
    playerFacing: spec.playerFacing,
    horizontalBlockStopsChaser:
      spec.horizontalBlockStopsChaser ?? false,
    rooms: [],
    roomExits: [],
    corridorCameraSize: 16,
    objects,
    sightEnemies,
    switches,
    doors,
    goals,
    fusionWalls,
    pits,
    displayTargetEntityId:
      spec.alwaysShowTargetName ? objects[0]?.id : undefined,
    cameraAreas: [createCameraArea(spec.id, width, height)],
    solutionActions: spec.solutionActions,
  };
}

function createConnectedStage(
  roomStages: readonly TrialStageDefinition[],
): TrialStageDefinition {
  const worldWidth = 23;
  const spineX = 20;
  const firstRoomY = 3;
  const roomGap = 8;
  let nextRoomY = firstRoomY;
  const placements = roomStages.map((room, index) => {
    const placement = {
      room,
      spec: stageSpecs[index],
      x: 2 + Math.floor((15 - room.width) / 2),
      y: nextRoomY,
    };
    nextRoomY += room.height + roomGap;
    return placement;
  });
  const worldHeight = nextRoomY - roomGap + 4;
  const terrain: TrialTerrain[][] = Array.from(
    { length: worldHeight },
    () => Array.from({ length: worldWidth }, () => "wall" as const),
  );
  const objects: NamedEntityDefinition[] = [];
  const sightEnemies: SightEnemyDefinition[] = [];
  const switches: SwitchDefinition[] = [];
  const doors: DoorDefinition[] = [];
  const fusionWalls: FusionWallDefinition[] = [];
  const pits = [];
  const rooms: TrialRoomDefinition[] = [];
  const roomExits = [];
  const cameraAreas = [];

  for (const placement of placements) {
    const { room, spec, x: offsetX, y: offsetY } = placement;
    for (let y = 0; y < room.height; y += 1) {
      for (let x = 0; x < room.width; x += 1) {
        terrain[offsetY + y][offsetX + x] = room.terrain[y][x];
      }
    }

    const translate = (point: GridPoint): GridPoint => ({
      x: point.x + offsetX,
      y: point.y + offsetY,
    });
    objects.push(
      ...room.objects.map((entry) => ({
        ...entry,
        position: translate(entry.position),
        roomId: room.id,
      })),
    );
    sightEnemies.push(
      ...room.sightEnemies.map((entry) => ({
        ...entry,
        position: translate(entry.position),
        roomId: room.id,
      })),
    );
    switches.push(
      ...room.switches.map((entry) => ({
        ...entry,
        position: translate(entry.position),
      })),
    );
    doors.push(
      ...room.doors.map((entry) => ({
        ...entry,
        position: translate(entry.position),
      })),
    );
    fusionWalls.push(
      ...room.fusionWalls.map((entry) => ({
        ...entry,
        position: translate(entry.position),
      })),
    );
    pits.push(
      ...room.pits.map((entry) => ({
        ...entry,
        position: translate(entry.position),
      })),
    );

    const bounds = {
      x: offsetX,
      y: offsetY,
      width: room.width,
      height: room.height,
    };
    const cameraAreaId = `${room.id}-world-camera`;
    const viewSize = Math.max(room.width, room.height) + 1;
    const sourceTargetId = room.displayTargetEntityId;
    rooms.push({
      id: room.id,
      number: room.number,
      title: room.title,
      hint: room.hint,
      bounds,
      playerStart: translate(room.playerStart),
      playerFacing: room.playerFacing,
      exitPosition: translate(room.goals[0]),
      cameraAreaId,
      completionConditionId: `room-complete-${room.id}`,
      horizontalBlockStopsChaser: room.horizontalBlockStopsChaser,
      displayTargetEntityId: sourceTargetId,
      solutionActions: room.solutionActions,
    });
    cameraAreas.push({
      id: cameraAreaId,
      trigger: bounds,
      view: {
        x: offsetX + (room.width - viewSize) / 2,
        y: offsetY + (room.height - viewSize) / 2,
        width: viewSize,
        height: viewSize,
      },
      transitionMs: 180,
    });

    if (spec.fusion?.createsLetter) {
      for (const wall of fusionWalls.filter((entry) =>
        entry.id.startsWith(`${room.id}-fusion-wall-`)
      )) {
        wall.createsLetter = true;
      }
    }
  }

  const connectionYValues: number[] = [];
  for (let index = 0; index < rooms.length - 1; index += 1) {
    const room = rooms[index];
    const spec = stageSpecs[index];
    const exitSide = spec.exitSide ?? "right";
    const exitOutside = outsidePoint(
      room.exitPosition,
      room.bounds,
      exitSide,
    );
    carveLine(terrain, room.exitPosition, exitOutside);
    carveLine(terrain, exitOutside, {
      x: spineX,
      y: exitOutside.y,
    });
    connectionYValues.push(exitOutside.y);
    roomExits.push({
      roomId: room.id,
      position: { ...room.exitPosition },
      conditionId: room.completionConditionId,
    });

    const nextRoom = rooms[index + 1];
    const nextSpec = stageSpecs[index + 1];
    const entrySide = nextSpec.entrySide ?? "top";
    const entryOutsideY =
      entrySide === "top"
        ? nextRoom.bounds.y - 2
        : nextRoom.bounds.y + nextRoom.bounds.height + 1;
    const entryOutside = {
      x: nextRoom.playerStart.x,
      y: entryOutsideY,
    };
    carveLine(terrain, { x: spineX, y: entryOutsideY }, entryOutside);
    carveLine(terrain, entryOutside, nextRoom.playerStart);
    connectionYValues.push(entryOutsideY);

    const gatePosition = {
      x: nextRoom.playerStart.x,
      y:
        nextRoom.playerStart.y +
        (entrySide === "top" ? -1 : 1),
    };
    terrain[gatePosition.y][gatePosition.x] = "floor";
    doors.push({
      id: `connector-door-${room.id}-to-${nextRoom.id}`,
      position: gatePosition,
      requiredSwitchIds: [],
      requiredConditionIds: [room.completionConditionId],
    });
  }

  if (connectionYValues.length > 0) {
    const minimumY = Math.min(...connectionYValues);
    const maximumY = Math.max(...connectionYValues);
    carveLine(
      terrain,
      { x: spineX, y: minimumY },
      { x: spineX, y: maximumY },
    );
  }

  const finalRoom = rooms[rooms.length - 1];
  const mapRows = terrain.map((row) =>
    row.map((tile) => (tile === "wall" ? "#" : ".")).join("")
  );

  return {
    id: "connected-mirishira-world",
    number: 1,
    title: "つながるミリしら街道",
    hint: rooms[0].hint,
    width: worldWidth,
    height: worldHeight,
    mapRows,
    terrain,
    playerStart: { ...rooms[0].playerStart },
    playerFacing: roomStages[0].playerFacing,
    horizontalBlockStopsChaser: false,
    rooms,
    roomExits,
    corridorCameraSize: 16,
    objects,
    sightEnemies,
    switches,
    doors,
    goals: [{ ...finalRoom.exitPosition }],
    fusionWalls,
    pits,
    cameraAreas,
    solutionActions: [],
  };
}

function outsidePoint(
  position: GridPoint,
  bounds: GridRect,
  side: "right" | "top" | "bottom",
): GridPoint {
  if (side === "top") {
    return { x: position.x, y: bounds.y - 2 };
  }
  if (side === "bottom") {
    return {
      x: position.x,
      y: bounds.y + bounds.height + 1,
    };
  }
  return { x: 20, y: position.y };
}

function carveLine(
  terrain: TrialTerrain[][],
  from: GridPoint,
  to: GridPoint,
): void {
  let point = { ...from };
  terrain[point.y][point.x] = "floor";
  while (point.x !== to.x) {
    point = {
      x: point.x + Math.sign(to.x - point.x),
      y: point.y,
    };
    terrain[point.y][point.x] = "floor";
  }
  while (point.y !== to.y) {
    point = {
      x: point.x,
      y: point.y + Math.sign(to.y - point.y),
    };
    terrain[point.y][point.x] = "floor";
  }
}

function createCameraArea(
  stageId: string,
  width: number,
  height: number,
): {
  id: string;
  trigger: GridRect;
  view: GridRect;
  transitionMs: number;
} {
  const size = Math.max(width, height) + 1;
  return {
    id: `${stageId}-camera`,
    trigger: { x: 0, y: 0, width, height },
    view: {
      x: (width - size) / 2,
      y: (height - size) / 2,
      width: size,
      height: size,
    },
    transitionMs: stageId === "meeting-knight-rampart" ? 0 : 180,
  };
}

function createSwitch(
  stageId: string,
  position: GridPoint,
): SwitchDefinition {
  return {
    id: `${stageId}-switch-${position.x}-${position.y}`,
    position,
  };
}

function repeat(action: TrialAction, count: number): TrialAction[] {
  return Array.from({ length: count }, () => action);
}

function pointsEqual(first: GridPoint, second: GridPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}
