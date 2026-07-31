import { describe, expect, it } from "vitest";
import {
  advanceTrialStage,
  createTrialCampaignState,
  getActiveTrialRoom,
  getActiveTrialStage,
  getDangerTileKeys,
  isDoorOpen,
  isSwitchOn,
  resetTrialStage,
  resolveTrialAction,
  splitGraphemes,
} from "../src/game/trial/rules";
import {
  trialRooms,
  trialStages,
  validateTrialStages,
} from "../src/game/trial/stages";
import type {
  TrialAction,
  TrialCampaignState,
  TrialRoomDefinition,
} from "../src/game/trial/types";

const MEETING_SETUP: readonly TrialAction[] = [
  "up",
  "up",
  "down",
  "down",
  "right",
  "right",
  "right",
  "down",
];

const MEETING_EXIT: readonly TrialAction[] = [
  "right",
  "down",
  "down",
  "down",
  "right",
  "right",
  "right",
];

describe("connected world data", () => {
  it("builds all fourteen rooms into one logical map", () => {
    expect(() => validateTrialStages()).not.toThrow();
    expect(trialStages).toHaveLength(1);
    expect(trialRooms).toHaveLength(14);

    const world = trialStages[0];
    expect(world.rooms).toHaveLength(14);
    expect(world.roomExits).toHaveLength(13);
    expect(world.cameraAreas).toHaveLength(14);
    expect(world.height).toBeGreaterThan(150);
    expect(world.rooms[0].id).toBe("tree-single-letter");
    expect(world.rooms.at(-1)?.id).toBe("meeting-knight-rampart");
    expect(world.rooms.some((room) => room.id === "slime-buddha")).toBe(
      true,
    );
  });

  it("uses hiragana for every Japanese slash name", () => {
    for (const entity of trialStages[0].objects) {
      expect(entity.jpName, entity.id).toMatch(/^[ぁ-ゖー]+$/u);
    }
  });

  it("keeps a walkable two-way road between every adjacent room", () => {
    const world = trialStages[0];
    for (let index = 0; index < world.rooms.length - 1; index += 1) {
      const state = createTrialCampaignState([], index + 1);
      const from = world.rooms[index].exitPosition;
      const to = world.rooms[index + 1].playerStart;
      expect(
        hasTerrainRoute(state, from, to),
        `${world.rooms[index].id} is not connected to ${world.rooms[index + 1].id}`,
      ).toBe(true);
      expect(hasTerrainRoute(state, to, from)).toBe(true);
    }
  });

  it("starts in the first room and can fast-travel without changing worlds", () => {
    const first = createTrialCampaignState();
    expect(first.stageIndex).toBe(0);
    expect(first.roomIndex).toBe(0);
    expect(getActiveTrialRoom(first).id).toBe("tree-single-letter");

    const slimeIndex = roomIndex("slime-buddha");
    const slime = createTrialCampaignState([], slimeIndex);
    expect(slime.stageIndex).toBe(0);
    expect(slime.roomIndex).toBe(slimeIndex);
    expect(getActiveTrialRoom(slime).id).toBe("slime-buddha");
  });

  it("walks from the cleared first room into the second room and back", () => {
    const world = trialStages[0];
    const firstRoom = world.rooms[0];
    const secondRoom = world.rooms[1];
    let state = playActions(
      createTrialCampaignState(),
      trialRooms[0].solutionActions,
    );
    expect(state.run.activeConditionIds).toContain(
      firstRoom.completionConditionId,
    );

    const forward = findWalkPath(
      state,
      state.run.player,
      secondRoom.playerStart,
    );
    expect(forward.length).toBeGreaterThan(0);
    state = playActions(state, forward);
    expect(state.run.currentRoomId).toBe(secondRoom.id);
    expect(state.roomIndex).toBe(1);

    const backward = findWalkPath(
      state,
      state.run.player,
      firstRoom.playerStart,
    );
    expect(backward.length).toBeGreaterThan(0);
    state = playActions(state, backward);
    expect(state.run.currentRoomId).toBe(firstRoom.id);
    expect(state.roomIndex).toBe(0);
    expect(state.run.status).toBe("playing");
  });
});

describe("slime to Buddha", () => {
  it("prints the full hiragana slime name, including unused す and ら", () => {
    expect(splitGraphemes("すらいむ")).toEqual(["す", "ら", "い", "む"]);
    const cut = resolveTrialAction(
      createTrialCampaignState([], roomIndex("slime-buddha")),
      "slash-jp",
    );

    expect(cut.slash?.succeeded).toBe(true);
    expect(cut.slash?.name).toBe("すらいむ");
    expect(cut.state.run.letters.map((letter) => letter.character)).toEqual([
      "す",
      "ら",
      "い",
      "む",
    ]);
  });

  it("combines adjacent い and む into one movable 仏 block", () => {
    const initial = createTrialCampaignState(
      [],
      roomIndex("slime-buddha"),
    );
    const beforeFusion = playActions(
      initial,
      roomTemplate("slime-buddha").solutionActions.slice(0, 7),
    );
    const fused = resolveTrialAction(beforeFusion, "right");
    const room = roomDefinition("slime-buddha");

    expect(fused.fusion?.result).toBe("仏");
    expect(fused.fusion?.createdLetterId).toBeDefined();
    expect(fused.state.run.letters.map((letter) => letter.character)).toEqual([
      "す",
      "ら",
      "仏",
    ]);
    const buddha = fused.state.run.letters.find(
      (letter) => letter.character === "仏",
    );
    expect(buddha?.position).toEqual(toWorld(room, { x: 5, y: 2 }));
  });

  it("pushes 仏 onto the switch and opens the room exit", () => {
    const index = roomIndex("slime-buddha");
    const completedRoom = playActions(
      createTrialCampaignState([], index),
      roomTemplate("slime-buddha").solutionActions,
    );
    const world = getActiveTrialStage(completedRoom);
    const room = roomDefinition("slime-buddha");
    const roomDoor = world.doors.find(
      (door) => pointInside(door.position, room.bounds) &&
        door.requiredSwitchIds.length > 0,
    );

    expect(
      isSwitchOn(
        completedRoom.run,
        toWorld(room, { x: 5, y: 4 }),
      ),
    ).toBe(true);
    expect(roomDoor).toBeDefined();
    expect(
      roomDoor && isDoorOpen(completedRoom.run, world, roomDoor),
    ).toBe(true);
    expect(completedRoom.run.activeConditionIds).toContain(
      room.completionConditionId,
    );
  });
});

describe("meeting knight room", () => {
  it("reaches the specified induced state without moving the knight early", () => {
    const index = roomIndex("meeting-knight-rampart");
    const room = roomDefinition("meeting-knight-rampart");
    const initial = createTrialCampaignState([], index);
    const knight = entityInRoom(initial, room.id);
    expect(knight?.position).toEqual(toWorld(room, { x: 2, y: 11 }));

    const induced = playActions(initial, MEETING_SETUP);
    expect(induced.run.player).toEqual(toWorld(room, { x: 7, y: 7 }));
    expect(induced.run.facing).toBe("down");
    expect(entityInRoom(induced, room.id)?.position).toEqual(
      toWorld(room, { x: 7, y: 8 }),
    );
  });

  it("lets KNIGHT stop all three sight lines and open the door", () => {
    const index = roomIndex("meeting-knight-rampart");
    const room = roomDefinition("meeting-knight-rampart");
    const induced = playActions(
      createTrialCampaignState([], index),
      MEETING_SETUP,
    );
    const cut = resolveTrialAction(induced, "slash-en");
    const world = getActiveTrialStage(cut.state);

    expect(cut.slash?.succeeded).toBe(true);
    expect(
      cut.state.run.letters
        .filter((letter) => pointInside(letter.position, room.bounds))
        .map((letter) => letter.character),
    ).toEqual(["K", "N", "I", "G", "H", "T"]);

    const danger = getDangerTileKeys(cut.state);
    for (const localY of [9, 10, 11]) {
      expect(
        danger.has(pointKey(toWorld(room, { x: 6, y: localY }))),
      ).toBe(true);
      expect(
        danger.has(pointKey(toWorld(room, { x: 8, y: localY }))),
      ).toBe(false);
    }
    const roomDoor = world.doors.find(
      (door) =>
        pointInside(door.position, room.bounds) &&
        door.requiredSwitchIds.length > 0,
    );
    expect(
      roomDoor && isDoorOpen(cut.state.run, world, roomDoor),
    ).toBe(true);
  });

  it("clears the connected prototype at the final room exit", () => {
    const index = roomIndex("meeting-knight-rampart");
    const completed = playActions(
      createTrialCampaignState([], index),
      [
        ...MEETING_SETUP,
        "slash-en",
        ...MEETING_EXIT,
      ],
    );
    expect(completed.run.status).toBe("completed");
    expect(advanceTrialStage(completed).isClear).toBe(true);
  });

  it("does not let the living knight block sight", () => {
    const index = roomIndex("meeting-knight-rampart");
    const room = roomDefinition("meeting-knight-rampart");
    const initial = createTrialCampaignState([], index);
    const danger = getDangerTileKeys(initial);
    expect(
      danger.has(pointKey(toWorld(room, { x: 2, y: 11 }))),
    ).toBe(true);
    expect(
      danger.has(pointKey(toWorld(room, { x: 13, y: 11 }))),
    ).toBe(true);
  });
});

describe("room solutions and reset", () => {
  it("replays every room solution without breaking the connected run", () => {
    for (const [index, template] of trialRooms.entries()) {
      const room = trialStages[0].rooms[index];
      const result = playActions(
        createTrialCampaignState([], index),
        template.solutionActions,
      );
      if (index === trialRooms.length - 1) {
        expect(result.run.status, template.id).toBe("completed");
      } else {
        expect(result.run.status, template.id).toBe("playing");
        expect(
          result.run.activeConditionIds,
          `${template.id} did not unlock its road`,
        ).toContain(room.completionConditionId);
      }
    }
  });

  it("resets the current room and preserves fast-travel access behind it", () => {
    const index = roomIndex("slime-buddha");
    const changed = playActions(
      createTrialCampaignState([], index),
      ["slash-jp", "up", "right", "down"],
    );
    const reset = resetTrialStage(changed);
    const fresh = createTrialCampaignState([], index);
    expect(reset.run).toEqual(fresh.run);
    expect(reset.roomIndex).toBe(index);
  });
});

function roomIndex(id: string): number {
  const index = trialStages[0].rooms.findIndex((room) => room.id === id);
  if (index < 0) throw new Error(`Missing room ${id}`);
  return index;
}

function roomDefinition(id: string): TrialRoomDefinition {
  return trialStages[0].rooms[roomIndex(id)];
}

function roomTemplate(id: string) {
  const room = trialRooms.find((entry) => entry.id === id);
  if (!room) throw new Error(`Missing room template ${id}`);
  return room;
}

function toWorld(
  room: TrialRoomDefinition,
  local: { x: number; y: number },
) {
  return {
    x: room.bounds.x + local.x,
    y: room.bounds.y + local.y,
  };
}

function entityInRoom(state: TrialCampaignState, roomId: string) {
  const world = getActiveTrialStage(state);
  return state.run.objects.find((entity) => {
    const definition = world.objects.find((entry) => entry.id === entity.id);
    return definition?.roomId === roomId && entity.isAlive;
  });
}

function playActions(
  initial: TrialCampaignState,
  actions: readonly TrialAction[],
): TrialCampaignState {
  return actions.reduce(
    (state, action) => resolveTrialAction(state, action).state,
    initial,
  );
}

function pointInside(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x < bounds.x + bounds.width &&
    point.y < bounds.y + bounds.height
  );
}

function pointKey(point: { x: number; y: number }): string {
  return `${point.x},${point.y}`;
}

function hasTerrainRoute(
  state: TrialCampaignState,
  start: { x: number; y: number },
  goal: { x: number; y: number },
): boolean {
  const stage = getActiveTrialStage(state);
  const blockedDoors = new Set(
    stage.doors
      .filter((door) => !isDoorOpen(state.run, stage, door))
      .map((door) => pointKey(door.position)),
  );
  const queue = [start];
  const visited = new Set([pointKey(start)]);
  const goalKey = pointKey(goal);
  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    if (point.x === goal.x && point.y === goal.y) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: point.x + dx, y: point.y + dy };
      const key = pointKey(next);
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= stage.width ||
        next.y >= stage.height ||
        stage.terrain[next.y][next.x] === "wall" ||
        (blockedDoors.has(key) && key !== goalKey) ||
        visited.has(key)
      ) {
        continue;
      }
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
}

function findWalkPath(
  state: TrialCampaignState,
  start: { x: number; y: number },
  goal: { x: number; y: number },
): TrialAction[] {
  const stage = getActiveTrialStage(state);
  const blocked = new Set<string>();
  for (const letter of state.run.letters) {
    blocked.add(pointKey(letter.position));
  }
  for (const entity of state.run.objects) {
    if (entity.isAlive) blocked.add(pointKey(entity.position));
  }
  for (const sight of stage.sightEnemies) {
    blocked.add(pointKey(sight.position));
  }
  for (const pit of stage.pits) {
    if (!state.run.filledPitIds.includes(pit.id)) {
      blocked.add(pointKey(pit.position));
    }
  }
  for (const door of stage.doors) {
    if (!isDoorOpen(state.run, stage, door)) {
      blocked.add(pointKey(door.position));
    }
  }

  const directions: readonly [
    TrialAction,
    number,
    number,
  ][] = [
    ["right", 1, 0],
    ["down", 0, 1],
    ["left", -1, 0],
    ["up", 0, -1],
  ];
  const startKey = pointKey(start);
  const goalKey = pointKey(goal);
  const queue = [start];
  const visited = new Set([startKey]);
  const previous = new Map<
    string,
    { key: string; action: TrialAction }
  >();

  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    const currentKey = pointKey(point);
    if (currentKey === goalKey) break;
    for (const [action, dx, dy] of directions) {
      const next = { x: point.x + dx, y: point.y + dy };
      const key = pointKey(next);
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= stage.width ||
        next.y >= stage.height ||
        stage.terrain[next.y][next.x] === "wall" ||
        blocked.has(key) ||
        visited.has(key)
      ) {
        continue;
      }
      visited.add(key);
      previous.set(key, { key: currentKey, action });
      queue.push(next);
    }
  }

  if (!visited.has(goalKey)) return [];
  const actions: TrialAction[] = [];
  let key = goalKey;
  while (key !== startKey) {
    const step = previous.get(key);
    if (!step) return [];
    actions.push(step.action);
    key = step.key;
  }
  return actions.reverse();
}
