import type { HeroDirection } from "../assets/GameAssets";
import type { GridPoint } from "../core/stageTypes";
import { trialStages } from "./stages";
import type {
  DoorDefinition,
  NamedEntityDefinition,
  NamedEntityState,
  SlashLanguage,
  TrialAction,
  TrialActionResult,
  TrialCampaignState,
  TrialLetterState,
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
  stageIndex = 0,
): TrialCampaignState {
  const safeIndex = Math.max(0, Math.min(stageIndex, trialStages.length - 1));
  return {
    stageIndex: safeIndex,
    run: createRunState(trialStages[safeIndex]),
    discoveredUnknownIds: [...new Set(discoveredUnknownIds)],
    isClear: false,
  };
}

export function resetTrialStage(
  state: TrialCampaignState,
): TrialCampaignState {
  if (state.isClear) {
    return createTrialCampaignState(state.discoveredUnknownIds, 0);
  }
  return {
    ...state,
    run: createRunState(getActiveTrialStage(state)),
  };
}

export function advanceTrialStage(
  state: TrialCampaignState,
): TrialCampaignState {
  if (state.run.status !== "completed") return state;
  const nextIndex = state.stageIndex + 1;
  if (nextIndex >= trialStages.length) {
    return {
      ...state,
      isClear: true,
    };
  }
  return {
    ...state,
    stageIndex: nextIndex,
    run: createRunState(trialStages[nextIndex]),
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
  let slash: TrialActionResult["slash"];
  let fusion: TrialActionResult["fusion"];
  let pendingConditionId: string | undefined;

  if (isDirection(action)) {
    run.facing = action;
    const movementResult = resolveMove(stage, run, action);
    consumedTurn = movementResult.consumedTurn;
    movedPlayer = movementResult.movedPlayer;
    pushedLetterId = movementResult.pushedLetterId;
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
      slash,
      fusion,
      failed: false,
      completed: false,
    };
  }

  run.turnCount += 1;
  moveChasers(stage, run);

  if (hasChaserAt(stage, run, run.player)) {
    run.status = "failed";
    run.failureReason = "caught";
  }

  if (
    pendingConditionId &&
    !run.activeConditionIds.includes(pendingConditionId)
  ) {
    run.activeConditionIds = [
      ...run.activeConditionIds,
      pendingConditionId,
    ];
  }
  run.openDoorIds = computeOpenDoorIds(stage, run);

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

  return {
    state,
    consumedTurn,
    movedPlayer,
    pushedLetterId,
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

function createRunState(stage: TrialStageDefinition): TrialRunState {
  return {
    player: { ...stage.playerStart },
    facing: stage.playerFacing,
    objects: stage.objects.map((definition) => ({
      id: definition.id,
      position: { ...definition.position },
      isAlive: true,
    })),
    letters: [],
    activeConditionIds: [],
    openDoorIds: [],
    turnCount: 0,
    status: "playing",
  };
}

function cloneCampaignState(
  state: TrialCampaignState,
): TrialCampaignState {
  return {
    stageIndex: state.stageIndex,
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
    run.player = destination;
    return {
      consumedTurn: true,
      movedPlayer: true,
      pendingConditionId: wall.conditionId,
      fusion: {
        wallId: wall.id,
        result: wall.result,
        consumedLetters: chain.map((entry) => ({
          character: entry.character,
          position: { ...entry.position },
        })),
      },
    };
  }

  const next = addPoints(destination, movement);
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

function isChaserDestinationFree(
  stage: TrialStageDefinition,
  run: TrialRunState,
  point: GridPoint,
  movingEntityId: string,
): boolean {
  if (!isInside(stage, point) || stage.terrain[point.y][point.x] === "wall") {
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
  if (!isInside(stage, point) || stage.terrain[point.y][point.x] === "wall") {
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
  if (!isInside(stage, point) || stage.terrain[point.y][point.x] === "wall") {
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
