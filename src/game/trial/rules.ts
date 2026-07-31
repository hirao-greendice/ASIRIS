import type { HeroDirection } from "../assets/GameAssets";
import type { GridPoint } from "../core/stageTypes";
import {
  defaultTrialStageIndex,
  trialStages,
} from "./stages";
import type {
  DoorDefinition,
  NamedEntityDefinition,
  NamedEntityState,
  SlashLanguage,
  TrialAction,
  TrialActionResult,
  TrialCampaignState,
  TrialLetterState,
  TrialRoomDefinition,
  TrialRunState,
  TrialStageDefinition,
} from "./types";

const MOVEMENT: Readonly<Record<HeroDirection, GridPoint>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function splitGraphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmenter.segment(value), (entry) => entry.segment);
  }
  return Array.from(value);
}

export function createTrialCampaignState(
  discoveredUnknownIds: readonly string[] = [],
  roomIndex = defaultTrialStageIndex,
): TrialCampaignState {
  const stage = trialStages[0];
  const safeRoomIndex = Math.max(
    0,
    Math.min(roomIndex, stage.rooms.length - 1),
  );
  return {
    stageIndex: 0,
    roomIndex: safeRoomIndex,
    run: createRunState(stage, safeRoomIndex),
    discoveredUnknownIds: [...new Set(discoveredUnknownIds)],
    isClear: false,
  };
}

export function resetTrialStage(
  state: TrialCampaignState,
): TrialCampaignState {
  if (state.isClear) {
    return createTrialCampaignState(
      state.discoveredUnknownIds,
      state.roomIndex,
    );
  }
  return createTrialCampaignState(
    state.discoveredUnknownIds,
    state.roomIndex,
  );
}

export function advanceTrialStage(
  state: TrialCampaignState,
): TrialCampaignState {
  if (state.run.status !== "completed") return state;
  return {
    ...state,
    isClear: true,
  };
}

export function resolveTrialAction(
  sourceState: TrialCampaignState,
  action: TrialAction,
): TrialActionResult {
  if (action === "reset") {
    return emptyResult(resetTrialStage(sourceState));
  }
  if (sourceState.isClear || sourceState.run.status !== "playing") {
    return emptyResult(sourceState);
  }

  const stage = getActiveTrialStage(sourceState);
  const state = cloneCampaignState(sourceState);
  const run = state.run;
  let consumedTurn = false;
  let movedPlayer = false;
  let pushedLetterId: string | undefined;
  let filledPit: TrialActionResult["filledPit"];
  let slash: TrialActionResult["slash"];
  let fusion: TrialActionResult["fusion"];
  let pendingConditionId: string | undefined;

  if (isDirection(action)) {
    run.facing = action;
    const movementResult = resolveMove(stage, run, action);
    consumedTurn = movementResult.consumedTurn;
    movedPlayer = movementResult.movedPlayer;
    pushedLetterId = movementResult.pushedLetterId;
    filledPit = movementResult.filledPit;
    fusion = movementResult.fusion;
    pendingConditionId = movementResult.pendingConditionId;
  } else {
    const language: SlashLanguage =
      action === "slash-jp" ? "jp" : "en";
    slash = resolveSlash(stage, state, language);
    consumedTurn = true;
  }

  if (!consumedTurn) {
    return {
      state,
      consumedTurn: false,
      movedPlayer,
      pushedLetterId,
      filledPit,
      slash,
      fusion,
      failed: false,
      completed: false,
    };
  }

  run.turnCount += 1;
  if (
    pendingConditionId &&
    !run.activeConditionIds.includes(pendingConditionId)
  ) {
    run.activeConditionIds = [
      ...run.activeConditionIds,
      pendingConditionId,
    ];
  }
  for (const roomExit of stage.roomExits) {
    if (
      pointsEqual(roomExit.position, run.player) &&
      !run.activeConditionIds.includes(roomExit.conditionId)
    ) {
      run.activeConditionIds = [
        ...run.activeConditionIds,
        roomExit.conditionId,
      ];
    }
  }
  run.openDoorIds = computeOpenDoorIds(stage, run);

  moveChasers(stage, run);

  if (hasChaserAt(stage, run, run.player)) {
    run.status = "failed";
    run.failureReason = "caught";
  }

  if (
    run.status !== "failed" &&
    getDangerTileKeys(state).has(pointKey(run.player))
  ) {
    run.status = "failed";
    run.failureReason = "sight";
  } else if (
    run.status !== "failed" &&
    stage.goals.some((goal) => pointsEqual(goal, run.player))
  ) {
    run.status = "completed";
  }

  const enteredRoomIndex = stage.rooms.findIndex(
    (room) =>
      room.id !== run.currentRoomId &&
      pointsEqual(room.playerStart, run.player),
  );
  if (enteredRoomIndex >= 0) {
    run.currentRoomId = stage.rooms[enteredRoomIndex].id;
    state.roomIndex = enteredRoomIndex;
  }

  return {
    state,
    consumedTurn,
    movedPlayer,
    pushedLetterId,
    filledPit,
    slash,
    fusion,
    failed: run.status === "failed",
    completed: run.status === "completed",
  };
}

export function getActiveTrialStage(
  state: TrialCampaignState,
): TrialStageDefinition {
  const stage = trialStages[state.stageIndex];
  if (!stage) throw new Error(`Trial stage ${state.stageIndex} is missing.`);
  return stage;
}

export function getActiveTrialRoom(
  state: TrialCampaignState,
): TrialRoomDefinition {
  const stage = getActiveTrialStage(state);
  return (
    stage.rooms.find((room) => room.id === state.run.currentRoomId) ??
    stage.rooms[state.roomIndex] ??
    stage.rooms[0]
  );
}

export function getEntityDefinition(
  stage: TrialStageDefinition,
  entityId: string,
): NamedEntityDefinition {
  const definition = stage.objects.find((entry) => entry.id === entityId);
  if (!definition) throw new Error(`Unknown entity: ${entityId}`);
  return definition;
}

export function getFacingEntity(
  state: TrialCampaignState,
): {
  definition: NamedEntityDefinition;
  state: NamedEntityState;
  isDiscovered: boolean;
} | undefined {
  const stage = getActiveTrialStage(state);
  const movement = MOVEMENT[state.run.facing];
  const target = addPoints(state.run.player, movement);
  const entityState = state.run.objects.find(
    (entry) => entry.isAlive && pointsEqual(entry.position, target),
  );
  if (!entityState) return undefined;
  const definition = getEntityDefinition(stage, entityState.id);
  return {
    definition,
    state: entityState,
    isDiscovered:
      !definition.isUnknown ||
      state.discoveredUnknownIds.includes(definition.id),
  };
}

export function getDangerTileKeys(
  state: TrialCampaignState,
): Set<string> {
  const stage = getActiveTrialStage(state);
  const dangerous = new Set<string>();

  for (const enemy of stage.sightEnemies) {
    const movement = MOVEMENT[enemy.direction];
    let point = addPoints(enemy.position, movement);
    while (isInside(stage, point)) {
      if (isSightBlockingTile(stage, state.run, point)) break;
      dangerous.add(pointKey(point));
      point = addPoints(point, movement);
    }
  }
  return dangerous;
}

export function getChaserNextMove(
  state: TrialCampaignState,
  entityId: string,
): GridPoint | undefined {
  const stage = getActiveTrialStage(state);
  const entity = state.run.objects.find(
    (entry) => entry.id === entityId && entry.isAlive,
  );
  if (!entity) return undefined;
  const definition = getEntityDefinition(stage, entityId);
  if (definition.behavior !== "chaser") return undefined;
  if (
    definition.roomId !== state.run.currentRoomId ||
    !isPlayerInsideCurrentRoom(stage, state.run)
  ) {
    return undefined;
  }
  return chooseChaserMove(stage, state.run, entity);
}

export function isSwitchOn(
  run: TrialRunState,
  switchPosition: GridPoint,
): boolean {
  return run.letters.some((letter) =>
    pointsEqual(letter.position, switchPosition)
  );
}

export function isDoorOpen(
  run: TrialRunState,
  _stage: TrialStageDefinition,
  door: DoorDefinition,
): boolean {
  if (pointsEqual(run.player, door.position)) return true;
  return run.openDoorIds.includes(door.id);
}

function createRunState(
  stage: TrialStageDefinition,
  roomIndex: number,
): TrialRunState {
  const room = stage.rooms[roomIndex];
  const activeConditionIds = stage.rooms
    .slice(0, roomIndex)
    .map((entry) => entry.completionConditionId);
  const run: TrialRunState = {
    player: { ...room.playerStart },
    facing: room.playerFacing,
    objects: stage.objects.map((definition) => ({
      id: definition.id,
      position: { ...definition.position },
      isAlive: true,
    })),
    letters: [],
    activeConditionIds,
    openDoorIds: [],
    filledPitIds: [],
    currentRoomId: room.id,
    turnCount: 0,
    status: "playing",
  };
  run.openDoorIds = computeOpenDoorIds(stage, run);
  return run;
}

function cloneCampaignState(
  state: TrialCampaignState,
): TrialCampaignState {
  return {
    stageIndex: state.stageIndex,
    roomIndex: state.roomIndex,
    isClear: state.isClear,
    discoveredUnknownIds: [...state.discoveredUnknownIds],
    run: {
      ...state.run,
      player: { ...state.run.player },
      objects: state.run.objects.map((entry) => ({
        ...entry,
        position: { ...entry.position },
      })),
      letters: state.run.letters.map((entry) => ({
        ...entry,
        position: { ...entry.position },
      })),
      activeConditionIds: [...state.run.activeConditionIds],
      openDoorIds: [...state.run.openDoorIds],
      filledPitIds: [...state.run.filledPitIds],
    },
  };
}

function resolveMove(
  stage: TrialStageDefinition,
  run: TrialRunState,
  direction: HeroDirection,
): {
  consumedTurn: boolean;
  movedPlayer: boolean;
  pushedLetterId?: string;
  filledPit?: TrialActionResult["filledPit"];
  fusion?: TrialActionResult["fusion"];
  pendingConditionId?: string;
} {
  const movement = MOVEMENT[direction];
  const destination = addPoints(run.player, movement);
  if (!isBaseEntitySpace(stage, run, destination)) {
    return { consumedTurn: false, movedPlayer: false };
  }

  const firstLetter = findLetter(run, destination);
  if (!firstLetter) {
    run.player = destination;
    return { consumedTurn: true, movedPlayer: true };
  }

  const chain = collectLetterChain(run, destination, movement);
  if (chain.length >= 2) {
    const afterChain = addScaled(destination, movement, chain.length);
    const wall = stage.fusionWalls.find((entry) =>
      pointsEqual(entry.position, afterChain)
    );
    const matches =
      wall !== undefined &&
      wall.inputDirection === direction &&
      wall.recipe.length === chain.length &&
      wall.recipe.every(
        (character, index) => character === chain[index].character,
      );
    if (!wall || !matches) {
      return { consumedTurn: false, movedPlayer: false };
    }

    const consumedIds = new Set(chain.map((entry) => entry.id));
    run.letters = run.letters.filter((entry) => !consumedIds.has(entry.id));
    let createdLetterId: string | undefined;
    let resultPosition: GridPoint | undefined;
    if (wall.createsLetter) {
      createdLetterId =
        `${wall.id}-result-${run.turnCount + 1}-${wall.result}`;
      resultPosition = { ...chain[chain.length - 1].position };
      run.letters = [
        ...run.letters,
        {
          id: createdLetterId,
          sourceEntityId: chain[0].sourceEntityId,
          character: wall.result,
          position: resultPosition,
        },
      ];
    }
    run.player = destination;
    return {
      consumedTurn: true,
      movedPlayer: true,
      pendingConditionId: wall.conditionId,
      fusion: {
        wallId: wall.id,
        result: wall.result,
        createdLetterId,
        resultPosition,
        consumedLetters: chain.map((entry) => ({
          character: entry.character,
          position: { ...entry.position },
        })),
      },
    };
  }

  const next = addPoints(destination, movement);
  const pit = stage.pits.find((entry) => pointsEqual(entry.position, next));
  if (pit && !run.filledPitIds.includes(pit.id)) {
    const letterId = firstLetter.id;
    const character = firstLetter.character;
    const from = { ...firstLetter.position };
    run.letters = run.letters.filter((entry) => entry.id !== letterId);
    run.filledPitIds = [...run.filledPitIds, pit.id];
    run.player = destination;
    return {
      consumedTurn: true,
      movedPlayer: true,
      filledPit: {
        pitId: pit.id,
        letterId,
        character,
        from,
        position: { ...pit.position },
      },
    };
  }

  if (!isLetterDestinationFree(stage, run, next)) {
    return { consumedTurn: false, movedPlayer: false };
  }

  firstLetter.position = next;
  run.player = destination;
  return {
    consumedTurn: true,
    movedPlayer: true,
    pushedLetterId: firstLetter.id,
  };
}

function resolveSlash(
  stage: TrialStageDefinition,
  state: TrialCampaignState,
  language: SlashLanguage,
): NonNullable<TrialActionResult["slash"]> {
  const run = state.run;
  const movement = MOVEMENT[run.facing];
  const target = addPoints(run.player, movement);
  const entityState = run.objects.find(
    (entry) => entry.isAlive && pointsEqual(entry.position, target),
  );
  if (!entityState) {
    return {
      language,
      succeeded: false,
      blockedAt: target,
      attemptedPositions: [target],
    };
  }

  const definition = getEntityDefinition(stage, entityState.id);
  let revealed: NonNullable<TrialActionResult["slash"]>["revealed"];
  if (
    definition.isUnknown &&
    !state.discoveredUnknownIds.includes(definition.id)
  ) {
    state.discoveredUnknownIds = [
      ...state.discoveredUnknownIds,
      definition.id,
    ];
    revealed = {
      entityId: definition.id,
      jpName: definition.jpName,
      enName: definition.enName,
    };
  }

  const name = language === "jp" ? definition.jpName : definition.enName;
  const characters = splitGraphemes(name);
  const spawnPositions = characters.map((_, index) =>
    addScaled(entityState.position, movement, index)
  );
  const blockedIndex = spawnPositions.findIndex(
    (position) =>
      !isSlashSpawnFree(stage, run, position, entityState.id),
  );
  if (blockedIndex >= 0 || !definition.slashable) {
    return {
      language,
      targetEntityId: definition.id,
      name,
      succeeded: false,
      blockedAt: spawnPositions[Math.max(0, blockedIndex)] ?? target,
      attemptedPositions: spawnPositions,
      revealed,
    };
  }

  entityState.isAlive = false;
  const spawnedLetterIds: string[] = [];
  const turnNumber = run.turnCount + 1;
  const nextLetters = [...run.letters];
  characters.forEach((character, index) => {
    const id =
      `${definition.id}-${language}-${turnNumber}-letter-${index}`;
    spawnedLetterIds.push(id);
    nextLetters.push({
      id,
      sourceEntityId: definition.id,
      character,
      position: spawnPositions[index],
    });
  });
  run.letters = nextLetters;

  return {
    language,
    targetEntityId: definition.id,
    name,
    succeeded: true,
    attemptedPositions: spawnPositions,
    revealed,
    spawnedLetterIds,
  };
}

function moveChasers(
  stage: TrialStageDefinition,
  run: TrialRunState,
): void {
  for (const entity of run.objects) {
    if (!entity.isAlive) continue;
    const definition = getEntityDefinition(stage, entity.id);
    if (definition.behavior !== "chaser") continue;
    if (
      definition.roomId !== run.currentRoomId ||
      !isPlayerInsideCurrentRoom(stage, run)
    ) {
      continue;
    }
    const destination = chooseChaserMove(stage, run, entity);
    if (destination) entity.position = destination;
  }
}

function chooseChaserMove(
  stage: TrialStageDefinition,
  run: TrialRunState,
  entity: NamedEntityState,
): GridPoint | undefined {
  const horizontalDifference = run.player.x - entity.position.x;
  if (horizontalDifference !== 0) {
    const horizontal = {
      x: entity.position.x + Math.sign(horizontalDifference),
      y: entity.position.y,
    };
    if (isChaserDestinationFree(stage, run, horizontal, entity.id)) {
      return horizontal;
    }
    const room = stage.rooms.find(
      (entry) => entry.id === entityRoomId(stage, entity.id),
    );
    if (room?.horizontalBlockStopsChaser) return undefined;
  }

  const verticalDifference = run.player.y - entity.position.y;
  if (verticalDifference !== 0) {
    const vertical = {
      x: entity.position.x,
      y: entity.position.y + Math.sign(verticalDifference),
    };
    if (isChaserDestinationFree(stage, run, vertical, entity.id)) {
      return vertical;
    }
  }
  return undefined;
}

function entityRoomId(
  stage: TrialStageDefinition,
  entityId: string,
): string | undefined {
  return getEntityDefinition(stage, entityId).roomId;
}

function isPlayerInsideCurrentRoom(
  stage: TrialStageDefinition,
  run: TrialRunState,
): boolean {
  const room = stage.rooms.find(
    (entry) => entry.id === run.currentRoomId,
  );
  return room !== undefined && pointInsideRect(run.player, room.bounds);
}

function pointInsideRect(point: GridPoint, rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

function isChaserDestinationFree(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
  movingEntityId: string,
): boolean {
  if (!isTerrainWalkable(stage, run, point)) {
    return false;
  }
  if (findLetter(run, point)) return false;
  if (
    stage.doors.some(
      (door) =>
        pointsEqual(door.position, point) &&
        !isDoorOpen(run, stage, door),
    )
  ) {
    return false;
  }
  if (stage.sightEnemies.some((entry) => pointsEqual(entry.position, point))) {
    return false;
  }
  return !run.objects.some(
    (entry) =>
      entry.id !== movingEntityId &&
      entry.isAlive &&
      pointsEqual(entry.position, point),
  );
}

function isBaseEntitySpace(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
): boolean {
  if (!isTerrainWalkable(stage, run, point)) {
    return false;
  }
  if (stage.sightEnemies.some((entry) => pointsEqual(entry.position, point))) {
    return false;
  }
  if (run.objects.some((entry) => entry.isAlive && pointsEqual(entry.position, point))) {
    return false;
  }
  return !stage.doors.some(
    (door) =>
      pointsEqual(door.position, point) &&
      !isDoorOpen(run, stage, door),
  );
}

function isLetterDestinationFree(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
): boolean {
  return (
    isBaseEntitySpace(stage, run, point) &&
    !findLetter(run, point) &&
    !pointsEqual(run.player, point)
  );
}

function isSlashSpawnFree(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
  targetEntityId: string,
): boolean {
  if (!isTerrainWalkable(stage, run, point)) {
    return false;
  }
  if (findLetter(run, point)) return false;
  if (stage.sightEnemies.some((entry) => pointsEqual(entry.position, point))) {
    return false;
  }
  if (
    stage.doors.some(
      (door) =>
        pointsEqual(door.position, point) &&
        !isDoorOpen(run, stage, door),
    )
  ) {
    return false;
  }
  return !run.objects.some(
    (entry) =>
      entry.id !== targetEntityId &&
      entry.isAlive &&
      pointsEqual(entry.position, point),
  );
}

function isSightBlockingTile(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
): boolean {
  if (stage.terrain[point.y][point.x] === "wall") return true;
  if (findLetter(run, point)) return true;
  return stage.doors.some(
    (door) =>
      pointsEqual(door.position, point) &&
      !isDoorOpen(run, stage, door),
  );
}

function isTerrainWalkable(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
): boolean {
  if (!isInside(stage, point)) return false;
  const terrain = stage.terrain[point.y][point.x];
  if (terrain === "wall") return false;
  if (terrain !== "pit") return true;
  const pit = stage.pits.find((entry) => pointsEqual(entry.position, point));
  return pit !== undefined && run.filledPitIds.includes(pit.id);
}

function computeOpenDoorIds(
  stage: TrialStageDefinition,
  run: TrialRunState,
): string[] {
  return stage.doors
    .filter((door) => {
      const switchesOn = door.requiredSwitchIds.every((switchId) => {
        const definition = stage.switches.find(
          (entry) => entry.id === switchId,
        );
        return definition
          ? isSwitchOn(run, definition.position)
          : false;
      });
      const conditionsOn = door.requiredConditionIds.every((conditionId) =>
        run.activeConditionIds.includes(conditionId)
      );
      return switchesOn && conditionsOn;
    })
    .map((door) => door.id);
}

function collectLetterChain(
  run: TrialRunState,
  start: GridPoint,
  movement: GridPoint,
): TrialLetterState[] {
  const chain: TrialLetterState[] = [];
  let point = { ...start };
  while (true) {
    const letter = findLetter(run, point);
    if (!letter) return chain;
    chain.push(letter);
    point = addPoints(point, movement);
  }
}

function findLetter(
  run: TrialRunState,
  point: GridPoint,
): TrialLetterState | undefined {
  return run.letters.find((entry) => pointsEqual(entry.position, point));
}

function hasChaserAt(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
): boolean {
  return run.objects.some((entity) => {
    if (!entity.isAlive || !pointsEqual(entity.position, point)) return false;
    return getEntityDefinition(stage, entity.id).behavior === "chaser";
  });
}

function isInside(stage: TrialStageDefinition, point: GridPoint): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < stage.width &&
    point.y < stage.height
  );
}

function isDirection(action: TrialAction): action is HeroDirection {
  return (
    action === "up" ||
    action === "down" ||
    action === "left" ||
    action === "right"
  );
}

function addPoints(first: GridPoint, second: GridPoint): GridPoint {
  return { x: first.x + second.x, y: first.y + second.y };
}

function addScaled(
  first: GridPoint,
  second: GridPoint,
  scale: number,
): GridPoint {
  return {
    x: first.x + second.x * scale,
    y: first.y + second.y * scale,
  };
}

function pointsEqual(first: GridPoint, second: GridPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function emptyResult(state: TrialCampaignState): TrialActionResult {
  return {
    state,
    consumedTurn: false,
    movedPlayer: false,
    failed: false,
    completed: false,
  };
}
