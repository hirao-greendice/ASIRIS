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
  };
  doorConditionIds?: readonly string[];
  solutionActions: readonly TrialAction[];
}

const ENTITY_CATALOG: Readonly<Record<string, EntityCatalogEntry>> = {
  H: { kind: "snake", jpName: "ヘビ", enName: "SNAKE" },
  R: { kind: "stone", jpName: "石", enName: "STONE" },
  Q: { kind: "shield", jpName: "盾", enName: "SHIELD" },
  C: { kind: "crown", jpName: "王冠", enName: "CROWN" },
  K: { kind: "knight", jpName: "騎士", enName: "KNIGHT" },
  Y: { kind: "key", jpName: "鍵", enName: "KEY" },
  B: { kind: "bat", jpName: "コウモリ", enName: "BAT" },
  W: { kind: "fence", jpName: "塀", enName: "WALL" },
  M: { kind: "mimic", jpName: "ミミック", enName: "MIMIC" },
  F: { kind: "fire", jpName: "火", enName: "FIRE" },
};

const SIGHT_DIRECTIONS: Readonly<Record<string, HeroDirection>> = {
  ">": "right",
  "<": "left",
  "^": "up",
  v: "down",
};

const stageSpecs: readonly StageSpec[] = [
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
    id: "stone-space",
    title: "石の余白",
    hint: "出せることと、動かせることは同じではない。",
    width: 10,
    height: 6,
    mapRows: [
      "##########",
      "#G.D######",
      "###.######",
      "#PR....s##",
      "##########",
      "##########",
    ],
    playerFacing: "right",
    solutionActions: [
      "slash-jp",
      ...repeat("right", 5),
      ...repeat("left", 3),
      "up",
      "up",
      "left",
      "left",
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
      "#######D#",
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
    hint: "一振りで、防壁と遠くのスイッチをつなぐ。",
    width: 9,
    height: 9,
    mapRows: [
      "#########",
      "#....P..#",
      "#....K..#",
      "#>......#",
      "#>......#",
      "#>.....D#",
      "#.......#",
      "#....s.G#",
      "#########",
    ],
    playerFacing: "down",
    solutionActions: [
      "slash-en",
      "right",
      ...repeat("down", 4),
      "right",
      "down",
      "down",
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
    fusion: {
      inputDirection: "up",
      recipe: ["火", "火"],
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
];

export const trialStages: readonly TrialStageDefinition[] =
  stageSpecs.map(createStage);

export function validateTrialStages(
  stages: readonly TrialStageDefinition[] = trialStages,
): void {
  if (stages.length !== 10) {
    throw new Error(`Expected 10 trial stages, received ${stages.length}.`);
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
    if (stage.goals.length === 0) {
      throw new Error(`${stage.id}: goal is missing.`);
    }
    if (stage.cameraAreas.length !== 1) {
      throw new Error(`${stage.id}: exactly one camera area is required.`);
    }
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
  const chasers = new Set(spec.chaserSymbols ?? []);
  const unknowns = new Set(spec.unknownSymbols ?? []);

  spec.mapRows.forEach((row, y) => {
    const terrainRow: TrialTerrain[] = [];
    Array.from(row).forEach((symbol, x) => {
      const position = { x, y };
      terrainRow.push(symbol === "#" || symbol === "X" ? "wall" : "floor");

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
      } else if (symbol === "s") {
        switches.push(createSwitch(spec.id, position));
      } else if (symbol === "D") {
        doorPositions.push(position);
      } else if (symbol === "G") {
        goals.push(position);
      } else if (symbol === "X") {
        fusionPositions.push(position);
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
    objects,
    sightEnemies,
    switches,
    doors,
    goals,
    fusionWalls,
    cameraAreas: [createCameraArea(spec.id, width, height)],
    solutionActions: spec.solutionActions,
  };
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
    transitionMs: 180,
  };
}

function createSwitch(stageId: string, position: GridPoint): SwitchDefinition {
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
