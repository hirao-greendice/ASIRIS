import type { HeroDirection } from "../assets/GameAssets";
import {
  isWalkable,
  type GridPoint,
  type NamedObjectDefinition,
  type PuzzleDefinition,
  type StageDefinition,
} from "./stageTypes";

const LETTER_SPAWN_SECONDS = 0.32;
const LETTER_TRANSFORM_SECONDS = 0.3;
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
  transformElapsed: number | null;
}

export interface PuzzleState {
  definition: PuzzleDefinition;
  objects: NamedObjectState[];
  letters: LetterState[];
  completionCountdown: number | null;
  isSolved: boolean;
  solvedElapsed: number;
}

export type MoveResult =
  | { moved: false }
  | {
      moved: true;
      destination: GridPoint;
      pushedLetterId?: string;
      pushedLetterFrom?: GridPoint;
      advancesStage?: boolean;
      fixedLetter?: boolean;
    };

export interface AttackResult {
  cutName?: string;
}

export interface WorldUpdateResult {
  puzzleSolved: boolean;
}

export class WorldState {
  readonly playerTile: GridPoint;
  facing: HeroDirection;
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
      if (letter.transformElapsed !== null) {
        letter.transformElapsed = Math.min(
          LETTER_TRANSFORM_SECONDS,
          letter.transformElapsed + deltaSeconds,
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

    object.isCut = true;
    Array.from(object.definition.name).forEach((character, index) => {
      const spawn = object.definition.letterSpawns[index];
      puzzle.letters.push({
        id: `${object.definition.id}-letter-${index}`,
        sourceObjectId: object.definition.id,
        character,
        position: { ...spawn },
        isFixed: false,
        hasLanded: false,
        spawnFrom: { ...object.definition.position },
        spawnElapsed: 0,
        transformElapsed: null,
      });
    });
    return { cutName: object.definition.name };
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

    const letter = this.findLetter(puzzle, destination);
    if (!letter) {
      Object.assign(this.playerTile, destination);
      return { moved: true, destination };
    }
    if (letter.isFixed || !letter.hasLanded) return { moved: false };

    const pushedTo = {
      x: destination.x + movement.x,
      y: destination.y + movement.y,
    };
    if (!this.canLetterOccupy(puzzle, pushedTo, letter.id)) {
      return { moved: false };
    }

    const pushedLetterFrom = { ...letter.position };
    Object.assign(letter.position, pushedTo);
    const fixedLetter = this.tryFixLetter(puzzle, letter);
    Object.assign(this.playerTile, destination);
    return {
      moved: true,
      destination,
      pushedLetterId: letter.id,
      pushedLetterFrom,
      fixedLetter,
    };
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
    ignoredId?: string,
  ): LetterState | undefined {
    return puzzle.letters.find(
      (letter) =>
        letter.id !== ignoredId &&
        pointsEqual(letter.position, position),
    );
  }

  private canLetterOccupy(
    puzzle: PuzzleState,
    position: GridPoint,
    movingLetterId: string,
  ): boolean {
    return (
      isWalkable(this.stage, position) &&
      !this.findStandingObject(puzzle, position) &&
      !this.findLetter(puzzle, position, movingLetterId)
    );
  }

  private tryFixLetter(
    puzzle: PuzzleState,
    letter: LetterState,
  ): boolean {
    const slot = puzzle.definition.targetSlots.find((candidate) =>
      pointsEqual(candidate.position, letter.position)
    );
    if (!slot || slot.expected !== letter.character) return false;

    letter.isFixed = true;
    if (slot.transform === "person-radical") {
      letter.transformElapsed = 0;
    }

    const isComplete = puzzle.definition.targetSlots.every((target) =>
      puzzle.letters.some(
        (candidate) =>
          candidate.isFixed &&
          candidate.character === target.expected &&
          pointsEqual(candidate.position, target.position),
      )
    );
    if (isComplete && puzzle.completionCountdown === null) {
      puzzle.completionCountdown = COMPLETION_DELAY_SECONDS;
    }
    return true;
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
