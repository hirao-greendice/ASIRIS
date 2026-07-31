import { describe, expect, it } from "vitest";
import {
  advanceTrialStage,
  createTrialCampaignState,
  getActiveTrialStage,
  getChaserNextMove,
  getDangerTileKeys,
  isDoorOpen,
  resetTrialStage,
  resolveTrialAction,
  splitGraphemes,
} from "../src/game/trial/rules";
import { trialStages, validateTrialStages } from "../src/game/trial/stages";
import type {
  TrialAction,
  TrialCampaignState,
} from "../src/game/trial/types";

describe("name printing", () => {
  it("splits Japanese and English names into grapheme blocks", () => {
    expect(splitGraphemes("ヘビ")).toEqual(["ヘ", "ビ"]);
    expect(splitGraphemes("KNIGHT")).toEqual([
      "K",
      "N",
      "I",
      "G",
      "H",
      "T",
    ]);
    expect(splitGraphemes("e\u0301")).toEqual(["e\u0301"]);

    for (const stage of trialStages) {
      for (const object of stage.objects) {
        expect(splitGraphemes(object.jpName).length).toBeGreaterThan(0);
        expect(splitGraphemes(object.enName).length).toBeGreaterThan(0);
      }
    }
  });

  it("prints the whole name or nothing when a cell is blocked", () => {
    const initial = createTrialCampaignState([], 0);
    const result = resolveTrialAction(initial, "slash-en");

    expect(result.slash?.succeeded).toBe(false);
    expect(result.state.run.letters).toHaveLength(0);
    expect(result.state.run.objects[0].isAlive).toBe(true);
    expect(result.consumedTurn).toBe(true);
  });
});

describe("letters, sight, switches, and movement", () => {
  it("does not let a named object block sight, but lets its letter block it", () => {
    const initial = createTrialCampaignState([], 2);
    expect(getDangerTileKeys(initial).has("6,2")).toBe(true);
    expect(getDangerTileKeys(initial).has("7,2")).toBe(true);

    const cut = resolveTrialAction(initial, "slash-jp").state;
    expect(getDangerTileKeys(cut).has("6,2")).toBe(false);
    expect(getDangerTileKeys(cut).has("7,2")).toBe(false);
  });

  it("pushes one letter but never pushes an ordinary chain", () => {
    let shortName = createTrialCampaignState([], 1);
    shortName = resolveTrialAction(shortName, "slash-jp").state;
    const pushed = resolveTrialAction(shortName, "right");
    expect(pushed.consumedTurn).toBe(true);
    expect(pushed.pushedLetterId).toBeDefined();
    expect(pushed.state.run.letters[0].position).toEqual({ x: 3, y: 3 });

    let longName = createTrialCampaignState([], 1);
    longName = resolveTrialAction(longName, "slash-en").state;
    const blocked = resolveTrialAction(longName, "right");
    expect(blocked.consumedTurn).toBe(false);
    expect(blocked.state.run.player).toEqual({ x: 1, y: 3 });
    expect(blocked.state.run.letters).toHaveLength(5);
  });

  it("opens a linked door while its switch carries a letter", () => {
    const initial = createTrialCampaignState([], 0);
    const cut = resolveTrialAction(initial, "slash-jp").state;
    const stage = getActiveTrialStage(cut);
    expect(isDoorOpen(cut.run, stage, stage.doors[0])).toBe(true);
  });
});

describe("turns and chasing enemies", () => {
  it("does not move a chaser on a free facing change", () => {
    let state = createTrialCampaignState([], 6);
    state = resolveTrialAction(state, "left").state;
    const before = state.run.objects.find((entry) => entry.isAlive)?.position;
    const faced = resolveTrialAction(state, "up");
    const after = faced.state.run.objects.find((entry) => entry.isAlive)?.position;

    expect(faced.consumedTurn).toBe(false);
    expect(after).toEqual(before);
  });

  it("moves a chaser after a failed slash and an empty slash", () => {
    const failed = resolveTrialAction(
      createTrialCampaignState([], 6),
      "slash-en",
    );
    expect(failed.slash?.succeeded).toBe(false);
    expect(failed.failed).toBe(true);
    expect(failed.state.run.objects[0].position).toEqual({ x: 4, y: 4 });

    let waiting = createTrialCampaignState([], 7);
    waiting = resolveTrialAction(waiting, "slash-en").state;
    waiting = resolveTrialAction(waiting, "left").state;
    waiting = resolveTrialAction(waiting, "right").state;
    const before = waiting.run.objects.find((entry) => entry.isAlive)?.position;
    const miss = resolveTrialAction(waiting, "slash-jp");
    const after = miss.state.run.objects.find((entry) => entry.isAlive)?.position;
    expect(miss.slash?.targetEntityId).toBeUndefined();
    expect(after).not.toEqual(before);
  });

  it("uses horizontal-first pursuit and falls back to vertical movement", () => {
    const base = createTrialCampaignState([], 6);
    const initial = {
      ...base,
      run: { ...base.run, player: { x: 3, y: 4 } },
    };
    const next = getChaserNextMove(initial, initial.run.objects[0].id);
    expect(next).toEqual({ x: 3, y: 3 });

    let fenced = createTrialCampaignState([], 7);
    fenced = resolveTrialAction(fenced, "slash-en").state;
    fenced = resolveTrialAction(fenced, "left").state;
    fenced = resolveTrialAction(fenced, "right").state;
    fenced = resolveTrialAction(fenced, "slash-jp").state;
    const knight = fenced.run.objects.find((entry) => entry.isAlive);
    expect(knight?.position).toEqual({ x: 3, y: 1 });
    expect(knight && getChaserNextMove(fenced, knight.id)).toEqual({
      x: 3,
      y: 2,
    });
  });
});

describe("knowledge and fusion", () => {
  it("reveals both mimic names on the first attempt and keeps them after reset", () => {
    const initial = createTrialCampaignState([], 8);
    const attempted = resolveTrialAction(initial, "slash-en");
    expect(attempted.slash?.revealed).toMatchObject({
      jpName: "ミミック",
      enName: "MIMIC",
    });
    expect(attempted.state.discoveredUnknownIds).toHaveLength(1);

    const retried = resetTrialStage(attempted.state);
    expect(retried.discoveredUnknownIds).toEqual(
      attempted.state.discoveredUnknownIds,
    );
  });

  it("fuses only the exact recipe, order, and input direction", () => {
    const correct = makeFusionState(["火", "火"], "up");
    const fused = resolveTrialAction(correct, "up");
    expect(fused.fusion?.result).toBe("炎");
    expect(fused.state.run.activeConditionIds).toContain("fusion-fire");
    expect(fused.state.run.letters).toHaveLength(0);
    expect(fused.state.run.player).toEqual({ x: 4, y: 3 });

    const wrongText = resolveTrialAction(
      makeFusionState(["火", "水"], "up"),
      "up",
    );
    expect(wrongText.consumedTurn).toBe(false);
    expect(wrongText.state.run.letters).toHaveLength(2);

    const wrongDirection = resolveTrialAction(
      makeFusionState(["火", "火"], "left"),
      "left",
    );
    expect(wrongDirection.consumedTurn).toBe(false);
    expect(wrongDirection.fusion).toBeUndefined();
  });
});

describe("stage data and authored solutions", () => {
  it("validates all declared row and column sizes", () => {
    expect(() => validateTrialStages()).not.toThrow();
    expect(trialStages).toHaveLength(10);
    for (const stage of trialStages) {
      expect(stage.mapRows).toHaveLength(stage.height);
      expect(stage.mapRows.every((row) => row.length === stage.width)).toBe(
        true,
      );
    }
  });

  it("replays all ten solutionActions through prototype clear", () => {
    let state = createTrialCampaignState();
    const expectedCurrentRunTurns = [7, 13, 9, 9, 9, 30, 6, 12, 10, 26];
    const expectedConsumedInputs = [7, 13, 9, 9, 9, 30, 6, 12, 11, 26];

    for (const [index, stage] of trialStages.entries()) {
      expect(getActiveTrialStage(state).id).toBe(stage.id);
      const replay = playActionsWithStats(state, stage.solutionActions);
      state = replay.state;
      expect(state.run.status, `${stage.id} did not complete`).toBe(
        "completed",
      );
      expect(
        state.run.turnCount,
        `${stage.id} current run turn count was unexpected`,
      ).toBe(expectedCurrentRunTurns[index]);
      expect(
        replay.consumedInputs,
        `${stage.id} consumed action count was unexpected`,
      ).toBe(expectedConsumedInputs[index]);
      expect(replay.inputCount).toBe(stage.solutionActions.length);
      state = advanceTrialStage(state);
    }

    expect(state.isClear).toBe(true);
  });

  it("reproduces each documented wrong-language outcome", () => {
    const stage1 = resolveTrialAction(
      createTrialCampaignState([], 0),
      "slash-en",
    );
    expect(stage1.slash?.succeeded).toBe(false);

    let stage2 = resolveTrialAction(
      createTrialCampaignState([], 1),
      "slash-en",
    ).state;
    expect(resolveTrialAction(stage2, "right").consumedTurn).toBe(false);

    const stage3 = resolveTrialAction(
      createTrialCampaignState([], 2),
      "slash-en",
    );
    expect(stage3.slash?.succeeded).toBe(false);

    let stage4 = resolveTrialAction(
      createTrialCampaignState([], 3),
      "slash-jp",
    ).state;
    stage4 = playActions(stage4, [
      "down",
      "down",
      "right",
      "right",
      "right",
    ]);
    expect(stage4.run.status).toBe("failed");

    let stage5 = resolveTrialAction(
      createTrialCampaignState([], 4),
      "slash-jp",
    ).state;
    stage5 = playActions(stage5, ["right", "down", "down", "down"]);
    expect(stage5.run.status).toBe("failed");

    const stage6 = resolveTrialAction(
      createTrialCampaignState([], 5),
      "slash-jp",
    ).state;
    expect(stage6.run.letters.map((entry) => entry.character)).toEqual(["鍵"]);

    let stage7 = createTrialCampaignState([], 6);
    stage7 = resolveTrialAction(stage7, "left").state;
    stage7 = resolveTrialAction(stage7, "up").state;
    const wrongBat = resolveTrialAction(stage7, "slash-jp");
    expect(wrongBat.slash?.succeeded).toBe(false);

    const stage8 = resolveTrialAction(
      createTrialCampaignState([], 7),
      "slash-jp",
    ).state;
    expect(stage8.run.letters).toHaveLength(1);

    const stage9 = resolveTrialAction(
      createTrialCampaignState([], 8),
      "slash-jp",
    );
    expect(stage9.slash?.succeeded).toBe(true);
    expect(stage9.state.run.letters).toHaveLength(4);

    const stage10 = resolveTrialAction(
      playActions(createTrialCampaignState([], 9), ["left", "up"]),
      "slash-en",
    ).state;
    expect(stage10.run.letters.map((entry) => entry.character)).toEqual([
      "F",
      "I",
      "R",
      "E",
    ]);
    expect(stage10.run.activeConditionIds).not.toContain("fusion-fire");
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

function playActionsWithStats(
  initial: TrialCampaignState,
  actions: readonly TrialAction[],
): {
  state: TrialCampaignState;
  inputCount: number;
  consumedInputs: number;
} {
  let state = initial;
  let consumedInputs = 0;
  for (const action of actions) {
    const result = resolveTrialAction(state, action);
    state = result.state;
    if (result.consumedTurn) consumedInputs += 1;
  }
  return {
    state,
    inputCount: actions.length,
    consumedInputs,
  };
}

function makeFusionState(
  characters: readonly [string, string],
  facing: "up" | "left",
): TrialCampaignState {
  const initial = createTrialCampaignState([], 9);
  if (facing === "up") {
    return {
      ...initial,
      run: {
        ...initial.run,
        player: { x: 4, y: 4 },
        facing,
        letters: characters.map((character, index) => ({
          id: `test-${index}`,
          sourceEntityId: "test",
          character,
          position: { x: 4, y: 3 - index },
        })),
      },
    };
  }

  return {
    ...initial,
    run: {
      ...initial.run,
      player: { x: 4, y: 4 },
      facing,
      letters: characters.map((character, index) => ({
        id: `test-${index}`,
        sourceEntityId: "test",
        character,
        position: { x: 3 - index, y: 4 },
      })),
    },
  };
}
