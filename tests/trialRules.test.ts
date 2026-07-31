import { describe, expect, it } from "vitest";
import {
  advanceTrialStage,
  createTrialCampaignState,
  getActiveTrialStage,
  getDangerTileKeys,
  isDoorOpen,
  isSwitchOn,
  resetTrialStage,
  resolveTrialAction,
  splitGraphemes,
} from "../src/game/trial/rules";
import {
  trialStages,
  validateTrialStages,
} from "../src/game/trial/stages";
import type {
  TrialAction,
  TrialCampaignState,
} from "../src/game/trial/types";

const SETUP_ACTIONS: readonly TrialAction[] = [
  "up",
  "up",
  "down",
  "down",
  "right",
  "right",
  "right",
  "down",
];

const EXIT_ACTIONS: readonly TrialAction[] = [
  "right",
  "down",
  "down",
  "down",
  "right",
  "right",
  "right",
];

const MEETING_STAGE_INDEX = trialStages.findIndex(
  (stage) => stage.id === "meeting-knight-rampart",
);
const MEETING_STAGE = trialStages[MEETING_STAGE_INDEX];

describe("15 by 15 meeting stage", () => {
  it("keeps the authored board available in the selectable stage list", () => {
    expect(() => validateTrialStages()).not.toThrow();
    expect(trialStages).toHaveLength(13);
    expect(MEETING_STAGE_INDEX).toBe(12);

    const stage = MEETING_STAGE;
    expect(stage.width).toBe(15);
    expect(stage.height).toBe(15);
    expect(stage.mapRows).toEqual([
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
    ]);
    expect(stage.playerStart).toEqual({ x: 4, y: 6 });
    expect(stage.objects[0]).toMatchObject({
      position: { x: 2, y: 11 },
      jpName: "騎士",
      enName: "KNIGHT",
      behavior: "chaser",
    });
    expect(stage.sightEnemies.map((enemy) => enemy.position)).toEqual([
      { x: 1, y: 9 },
      { x: 1, y: 10 },
      { x: 1, y: 11 },
    ]);
    expect(stage.doors[0].position).toEqual({ x: 11, y: 10 });
    expect(stage.switches[0].position).toEqual({ x: 7, y: 13 });
    expect(stage.cameraAreas[0].view).toEqual({
      x: -0.5,
      y: -0.5,
      width: 16,
      height: 16,
    });
  });

  it("splits both knight names into physical grapheme blocks", () => {
    expect(splitGraphemes("騎士")).toEqual(["騎", "士"]);
    expect(splitGraphemes("KNIGHT")).toEqual([
      "K",
      "N",
      "I",
      "G",
      "H",
      "T",
    ]);
  });
});

describe("knight pursuit and sight", () => {
  it("does not move before the first action and follows the authored setup", () => {
    const initial = createTrialCampaignState();
    expect(initial.run.objects[0].position).toEqual({ x: 2, y: 11 });

    const induced = playActions(initial, SETUP_ACTIONS);
    expect(induced.run.player).toEqual({ x: 7, y: 7 });
    expect(induced.run.facing).toBe("down");
    expect(induced.run.objects[0].position).toEqual({ x: 7, y: 8 });
    expect(induced.run.turnCount).toBe(8);
    expect(induced.run.status).toBe("playing");
  });

  it("moves the living knight after an empty slash", () => {
    const result = resolveTrialAction(
      createTrialCampaignState(),
      "slash-jp",
    );
    expect(result.consumedTurn).toBe(true);
    expect(result.slash?.targetEntityId).toBeUndefined();
    expect(result.state.run.objects[0]).toMatchObject({
      isAlive: true,
      position: { x: 3, y: 11 },
    });
  });

  it("does not let the living knight block a sight line", () => {
    const initial = createTrialCampaignState();
    const danger = getDangerTileKeys(initial);

    expect(danger.has("2,11")).toBe(true);
    expect(danger.has("3,11")).toBe(true);
    expect(danger.has("13,11")).toBe(true);
  });
});

describe("English solution", () => {
  it("spawns KNIGHT simultaneously, stops all three sights, and opens the door", () => {
    const induced = playActions(
      createTrialCampaignState(),
      SETUP_ACTIONS,
    );
    const cut = resolveTrialAction(induced, "slash-en");
    const stage = getActiveTrialStage(cut.state);

    expect(cut.slash?.succeeded).toBe(true);
    expect(cut.state.run.objects[0].isAlive).toBe(false);
    expect(
      cut.state.run.letters.map((letter) => ({
        character: letter.character,
        position: letter.position,
      })),
    ).toEqual([
      { character: "K", position: { x: 7, y: 8 } },
      { character: "N", position: { x: 7, y: 9 } },
      { character: "I", position: { x: 7, y: 10 } },
      { character: "G", position: { x: 7, y: 11 } },
      { character: "H", position: { x: 7, y: 12 } },
      { character: "T", position: { x: 7, y: 13 } },
    ]);

    const danger = getDangerTileKeys(cut.state);
    for (const row of [9, 10, 11]) {
      expect(danger.has(`6,${row}`)).toBe(true);
      expect(danger.has(`7,${row}`)).toBe(false);
      expect(danger.has(`8,${row}`)).toBe(false);
    }
    expect(isSwitchOn(cut.state.run, stage.switches[0].position)).toBe(true);
    expect(isDoorOpen(cut.state.run, stage, stage.doors[0])).toBe(true);
    expect(cut.state.run.turnCount).toBe(9);
  });

  it("clears with the documented sixteen actions", () => {
    const completed = playActions(
      createTrialCampaignState(),
      MEETING_STAGE.solutionActions,
    );

    expect(completed.run.status).toBe("completed");
    expect(completed.run.player).toEqual({ x: 11, y: 10 });
    expect(completed.run.turnCount).toBe(16);
    expect(advanceTrialStage(completed).isClear).toBe(true);
  });
});

describe("failure and reset rules", () => {
  it("cannot clear by using the Japanese name on the documented route", () => {
    const induced = playActions(
      createTrialCampaignState(),
      SETUP_ACTIONS,
    );
    const cut = resolveTrialAction(induced, "slash-jp").state;
    const stage = getActiveTrialStage(cut);

    expect(cut.run.letters.map((letter) => letter.character)).toEqual([
      "騎",
      "士",
    ]);
    expect(isDoorOpen(cut.run, stage, stage.doors[0])).toBe(false);

    const attemptedExit = playActions(cut, EXIT_ACTIONS);
    expect(attemptedExit.run.status).toBe("failed");
    expect(attemptedExit.run.failureReason).toBe("sight");
    expect(attemptedExit.run.status).not.toBe("completed");
  });

  it("never pushes two or more ordinary letters together", () => {
    const induced = playActions(
      createTrialCampaignState(),
      SETUP_ACTIONS,
    );
    const cut = resolveTrialAction(induced, "slash-en").state;
    const blocked = resolveTrialAction(cut, "down");

    expect(blocked.consumedTurn).toBe(false);
    expect(blocked.state.run.player).toEqual({ x: 7, y: 7 });
    expect(blocked.state.run.letters).toEqual(cut.run.letters);
    expect(blocked.state.run.turnCount).toBe(9);
  });

  it("keeps the knight and creates no new letters when printing is blocked", () => {
    const induced = playActions(
      createTrialCampaignState(),
      SETUP_ACTIONS,
    );
    const blockedState: TrialCampaignState = {
      ...induced,
      run: {
        ...induced.run,
        letters: [
          {
            id: "blocking-letter",
            sourceEntityId: "test",
            character: "X",
            position: { x: 7, y: 12 },
          },
        ],
      },
    };
    const failedCut = resolveTrialAction(blockedState, "slash-en");

    expect(failedCut.slash?.succeeded).toBe(false);
    expect(failedCut.slash?.blockedAt).toEqual({ x: 7, y: 12 });
    expect(failedCut.slash?.attemptedPositions).toHaveLength(6);
    expect(failedCut.state.run.objects[0].isAlive).toBe(true);
    expect(failedCut.state.run.letters).toEqual(
      blockedState.run.letters,
    );
    expect(failedCut.consumedTurn).toBe(true);
    expect(failedCut.state.run.failureReason).toBe("caught");
  });

  it("restores every mutable stage value on reset", () => {
    const changed = playActions(
      createTrialCampaignState(),
      MEETING_STAGE.solutionActions.slice(0, 9),
    );
    const reset = resetTrialStage(changed);
    const initial = createTrialCampaignState();

    expect(reset.stageIndex).toBe(MEETING_STAGE_INDEX);
    expect(reset.run).toEqual(initial.run);
    expect(reset.isClear).toBe(false);
  });
});

describe("stage selection data", () => {
  it("replays every selectable stage solution to completion", () => {
    for (const [stageIndex, stage] of trialStages.entries()) {
      const completed = playActions(
        createTrialCampaignState([], stageIndex),
        stage.solutionActions,
      );
      expect(
        completed.run.status,
        `${stage.number}. ${stage.title} did not complete`,
      ).toBe("completed");
    }
  });
});

function playActions(
  initial: TrialCampaignState,
  actions: readonly TrialAction[],
): TrialCampaignState {
  return actions.reduce(
    (state, action) => resolveTrialAction(state, action).state,
    initial,
  );
}
