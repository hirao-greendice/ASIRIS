import type { HeroDirection } from "../assets/GameAssets";
import {
  isWalkable,
  type GridPoint,
  type NamedObjectDefinition,
  type PuzzleDefinition,
  type StageDefinition,
  type SwordMode,
} from "./stageTypes";

const LETTER_SPAWN_SECONDS = 0.32;
const LETTER_FUSION_SECONDS = 0.34;
const COMPLETION_DELAY_SECONDS = 0.46;

const MOVEMENT: Record<HeroDirection, GridPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface NamedObjectState {
  definition: NamedObjectDefinition;
  isCut: boolean;
}

export interface LetterState {
  id: string;
  sourceObjectId: string;
  character: string;
  position: GridPoint;
  isFixed: boolean;
  hasLanded: boolean;
  spawnFrom: GridPoint;
  spawnElapsed: number;
  fusionElapsed: number | null;
}

export interface PuzzleState {
  definition: PuzzleDefinition;
  objects: NamedObjectState[];
  letters: LetterState[];
  completionCountdown: number | null;
  isSolved: boolean;
  solvedElapsed: number;
}

export interface PushedLetter {
  id: string;
  from: GridPoint;
}

export type MoveResult =
  | { moved: false }
  | {
      moved: true;
      destination: GridPoint;
      pushedLetters?: readonly PushedLetter[];
      advancesStage?: boolean;
      fusedResult?: string;
    };

export interface AttackResult {
  cutName?: string;
  blockedName?: string;
}

export interface WorldUpdateResult {
  puzzleSolved: boolean;
}

export class WorldState {
  readonly playerTile: GridPoint;
  facing: HeroDirection;
  swordMode: SwordMode = "kana";
  private puzzleStates: PuzzleState[];
  private activePuzzleIndex = 0;
  private prototypeClear = false;

  constructor(private readonly stage: StageDefinition) {
    this.puzzleStates = (stage.puzzles ?? []).map(createPuzzleState);
    const firstPuzzle = this.puzzleStates[0]?.definition;
    const start = firstPuzzle?.playerStart ?? stage.playerStart;
    this.playerTile = { ...start };
    this.facing = firstPuzzle?.playerFacing ?? "down";
  }

  get activePuzzle(): PuzzleState | undefined {
    return this.puzzleStates[this.activePuzzleIndex];
  }

  get puzzleCount(): number {
    return this.puzzleStates.length;
  }

  get isPrototypeClear(): boolean {
    return this.prototypeClear;
  }

  getObjectName(object: NamedObjectDefinition): string {
    return object.names[this.swordMode];
  }

  toggleSwordMode(): SwordMode {
    this.swordMode = this.swordMode === "kana" ? "english" : "kana";
    return this.swordMode;
  }

  update(deltaSeconds: number): WorldUpdateResult {
    const puzzle = this.activePuzzle;
    if (!puzzle) return { puzzleSolved: false };

    for (const letter of puzzle.letters) {
      if (!letter.hasLanded) {
        letter.spawnElapsed = Math.min(
          LETTER_SPAWN_SECONDS,
          letter.spawnElapsed + deltaSeconds,
        );
        letter.hasLanded = letter.spawnElapsed >= LETTER_SPAWN_SECONDS;
      }
      if (letter.fusionElapsed !== null) {
        letter.fusionElapsed = Math.min(
          LETTER_FUSION_SECONDS,
          letter.fusionElapsed + deltaSeconds,
        );
      }
    }

    let puzzleSolved = false;
    if (puzzle.completionCountdown !== null && !puzzle.isSolved) {
      puzzle.completionCountdown -= deltaSeconds;
      if (puzzle.completionCountdown <= 0) {
        puzzle.completionCountdown = null;
        puzzle.isSolved = true;
        puzzle.solvedElapsed = 0;
        puzzleSolved = true;
      }
    }

    if (puzzle.isSolved) {
      puzzle.solvedElapsed += deltaSeconds;
    }

    return { puzzleSolved };
  }

  attack(): AttackResult {
    const puzzle = this.activePuzzle;
    if (!puzzle) return {};

    const movement = MOVEMENT[this.facing];
    const target = {
      x: this.playerTile.x + movement.x,
      y: this.playerTile.y + movement.y,
    };
    const object = puzzle.objects.find(
      (candidate) =>
        !candidate.isCut &&
        pointsEqual(candidate.definition.position, target),
    );
    if (!object) return {};

    const name = this.getObjectName(object.definition);
    const characters = Array.from(name);
    const spawns = characters.map((_, index) => ({
      x: object.definition.position.x + index,
      y: object.definition.position.y,
    }));
    const canSpawn = spawns.every(
      (spawn) =>
        isWalkable(this.stage, spawn) &&
        !this.findLetter(puzzle, spawn) &&
        !puzzle.objects.some(
          (candidate) =>
            candidate.definition.id !== object.definition.id &&
            !candidate.isCut &&
            pointsEqual(candidate.definition.position, spawn),
        ),
    );
    if (!canSpawn) return { blockedName: name };

    object.isCut = true;
    characters.forEach((character, index) => {
      puzzle.letters.push({
        id: `${object.definition.id}-${this.swordMode}-letter-${index}`,
        sourceObjectId: object.definition.id,
        character,
        position: spawns[index],
        isFixed: false,
        hasLanded: false,
        spawnFrom: { ...object.definition.position },
        spawnElapsed: 0,
        fusionElapsed: null,
      });
    });
    return { cutName: name };
  }

  tryMove(direction: HeroDirection): MoveResult {
    const movement = MOVEMENT[direction];
    const destination = {
      x: this.playerTile.x + movement.x,
      y: this.playerTile.y + movement.y,
    };
    const puzzle = this.activePuzzle;

    if (!puzzle) {
      if (!isWalkable(this.stage, destination)) return { moved: false };
      Object.assign(this.playerTile, destination);
      return { moved: true, destination };
    }

    if (pointsEqual(destination, puzzle.definition.door.position)) {
      if (!puzzle.isSolved) return { moved: false };
      Object.assign(this.playerTile, destination);
      return { moved: true, destination, advancesStage: true };
    }

    if (!isWalkable(this.stage, destination)) return { moved: false };
    if (this.findStandingObject(puzzle, destination)) return { moved: false };

    const firstLetter = this.findLetter(puzzle, destination);
    if (!firstLetter) {
      Object.assign(this.playerTile, destination);
      return { moved: true, destination };
    }

    const chain = this.collectLetterChain(puzzle, destination, movement);
    if (
      chain.length === 0 ||
      chain.some((letter) => letter.isFixed || !letter.hasLanded)
    ) {
      return { moved: false };
    }

    const afterChain = {
      x: destination.x + movement.x * chain.length,
      y: destination.y + movement.y * chain.length,
    };
    const pressureRule = !isWalkable(this.stage, afterChain)
      ? this.findFusionRule(puzzle, chain)
      : undefined;

    if (pressureRule) {
      const fusedPosition = { ...chain[chain.length - 1].position };
      const fusedLetter: LetterState = {
        id:
          `${puzzle.definition.id}-fusion-` +
          chain.map((letter) => letter.id).join("-"),
        sourceObjectId: chain
          .map((letter) => letter.sourceObjectId)
          .join("+"),
        character: pressureRule.result,
        position: fusedPosition,
        isFixed:
          pressureRule.result === puzzle.definition.goal.result &&
          pointsEqual(fusedPosition, puzzle.definition.goal.position),
        hasLanded: true,
        spawnFrom: { ...fusedPosition },
        spawnElapsed: LETTER_SPAWN_SECONDS,
        fusionElapsed: 0,
      };
      const fusedIds = new Set(chain.map((letter) => letter.id));
      puzzle.letters = puzzle.letters.filter(
        (letter) => !fusedIds.has(letter.id),
      );
      puzzle.letters.push(fusedLetter);
      Object.assign(this.playerTile, destination);

      if (fusedLetter.isFixed && puzzle.completionCountdown === null) {
        puzzle.completionCountdown = COMPLETION_DELAY_SECONDS;
      }
      return {
        moved: true,
        destination,
        fusedResult: pressureRule.result,
      };
    }

    if (
      !isWalkable(this.stage, afterChain) ||
      this.findStandingObject(puzzle, afterChain) ||
      this.findLetter(puzzle, afterChain)
    ) {
      return { moved: false };
    }

    const pushedLetters = chain.map((letter) => ({
      id: letter.id,
      from: { ...letter.position },
    }));
    for (const letter of chain) {
      letter.position.x += movement.x;
      letter.position.y += movement.y;
    }
    Object.assign(this.playerTile, destination);
    return { moved: true, destination, pushedLetters };
  }

  advanceStage(): "advanced" | "clear" {
    const nextIndex = this.activePuzzleIndex + 1;
    if (nextIndex >= this.puzzleStates.length) {
      this.prototypeClear = true;
      return "clear";
    }

    this.activePuzzleIndex = nextIndex;
    this.puzzleStates[nextIndex] = createPuzzleState(
      this.puzzleStates[nextIndex].definition,
    );
    const nextPuzzle = this.puzzleStates[nextIndex].definition;
    Object.assign(this.playerTile, nextPuzzle.playerStart);
    this.facing = nextPuzzle.playerFacing;
    return "advanced";
  }

  reset(): void {
    if (this.prototypeClear && this.puzzleStates.length > 0) {
      this.puzzleStates = this.puzzleStates.map((puzzle) =>
        createPuzzleState(puzzle.definition)
      );
      this.activePuzzleIndex = 0;
      this.prototypeClear = false;
      this.swordMode = "kana";
    } else if (this.activePuzzle) {
      this.puzzleStates[this.activePuzzleIndex] = createPuzzleState(
        this.activePuzzle.definition,
      );
    }

    const puzzle = this.activePuzzle?.definition;
    const start = puzzle?.playerStart ?? this.stage.playerStart;
    Object.assign(this.playerTile, start);
    this.facing = puzzle?.playerFacing ?? "down";
  }

  private collectLetterChain(
    puzzle: PuzzleState,
    start: GridPoint,
    movement: GridPoint,
  ): LetterState[] {
    const chain: LetterState[] = [];
    let point = { ...start };

    while (true) {
      const letter = this.findLetter(puzzle, point);
      if (!letter) return chain;
      chain.push(letter);
      point = {
        x: point.x + movement.x,
        y: point.y + movement.y,
      };
    }
  }

  private findFusionRule(
    puzzle: PuzzleState,
    chain: readonly LetterState[],
  ) {
    const components = chain.map((letter) => letter.character);
    return puzzle.definition.fusionRules.find(
      (rule) =>
        rule.components.length === components.length &&
        rule.components.every(
          (component, index) => component === components[index],
        ),
    );
  }

  private findStandingObject(
    puzzle: PuzzleState,
    position: GridPoint,
  ): NamedObjectState | undefined {
    return puzzle.objects.find(
      (object) =>
        !object.isCut &&
        pointsEqual(object.definition.position, position),
    );
  }

  private findLetter(
    puzzle: PuzzleState,
    position: GridPoint,
  ): LetterState | undefined {
    return puzzle.letters.find((letter) =>
      pointsEqual(letter.position, position)
    );
  }
}

function createPuzzleState(definition: PuzzleDefinition): PuzzleState {
  return {
    definition,
    objects: definition.namedObjects.map((object) => ({
      definition: object,
      isCut: false,
    })),
    letters: [],
    completionCountdown: null,
    isSolved: false,
    solvedElapsed: 0,
  };
}

function pointsEqual(first: GridPoint, second: GridPoint): boolean {
  return first.x === second.x && first.y === second.y;
}
