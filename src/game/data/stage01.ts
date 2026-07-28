import type {
  CameraArea,
  StageDefinition,
  TileKind,
} from "../core/stageTypes";

const RAW_MAP = [
  "###########################",
  "#.....gg..................#",
  "#....ggg...........gg.....#",
  "#.....gg...........gg.....#",
  "#........#................#",
  "#........#.....###........#",
  "#........#................#",
  "#.........................#",
  "#................#........#",
  "#....###.........#........#",
  "#................#........#",
  "#.......gg................#",
  "#......ggg.........gg.....#",
  "#.......gg.........gg.....#",
  "###########################",
] as const;

const TILE_LEGEND: Record<string, TileKind> = {
  ".": "floor",
  g: "grass",
  "#": "wall",
};

const tiles = RAW_MAP.map((row) =>
  [...row].map((symbol) => {
    const tile = TILE_LEGEND[symbol];
    if (!tile) throw new Error(`Unknown stage tile: ${symbol}`);
    return tile;
  }),
);

const width = RAW_MAP[0].length;
if (RAW_MAP.some((row) => row.length !== width)) {
  throw new Error("Every stage row must have the same width.");
}

/*
 * Camera editing is data-driven. Each trigger is a player-tile range and each
 * view is the tile rectangle rendered to the square game screen.
 */
const cameraAreas: CameraArea[] = [
  {
    id: "west-north",
    trigger: { x: 0, y: 0, width: 9, height: 8 },
    view: { x: 0, y: 0, width: 9, height: 9 },
    transitionMs: 260,
  },
  {
    id: "center-north",
    trigger: { x: 9, y: 0, width: 9, height: 8 },
    view: { x: 9, y: 0, width: 9, height: 9 },
    transitionMs: 260,
  },
  {
    id: "east-north",
    trigger: { x: 18, y: 0, width: 9, height: 8 },
    view: { x: 18, y: 0, width: 9, height: 9 },
    transitionMs: 260,
  },
  {
    id: "west-south",
    trigger: { x: 0, y: 8, width: 9, height: 7 },
    view: { x: 0, y: 6, width: 9, height: 9 },
    transitionMs: 260,
  },
  {
    id: "center-south",
    trigger: { x: 9, y: 8, width: 9, height: 7 },
    view: { x: 9, y: 6, width: 9, height: 9 },
    transitionMs: 260,
  },
  {
    id: "east-south",
    trigger: { x: 18, y: 8, width: 9, height: 7 },
    view: { x: 18, y: 6, width: 9, height: 9 },
    transitionMs: 260,
  },
];

export const stage01: StageDefinition = {
  id: "stage-01",
  name: "接続テスト",
  width,
  height: RAW_MAP.length,
  tiles,
  playerStart: { x: 4, y: 7 },
  cameraAreas,
};
