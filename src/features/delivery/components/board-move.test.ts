import { describe, expect, it } from "vitest";

import { TASK_COLUMNS, TASK_COLUMN_ORDER, type TaskColumn } from "@/lib/data/kysely-database-types";

import { placeIdAtPosition, type BoardDTO, type TaskCardDTO } from "../delivery.types";
import { applyMove, indexBoard, isSamePlace, movePhaseOrder } from "./board-move";

// -------------------------------------------------------------------
// The board's arithmetic.
//
// Every case here is an off-by-one that LOOKS like a working board: a card
// landing one slot from where it was dropped, a "move up" writing the order
// that is already stored, a menu appending to the wrong end. None of them
// throws, so none of them shows up anywhere except in a test.
// -------------------------------------------------------------------

const card = (id: string, phaseId: string): TaskCardDTO => ({
  id,
  phaseId,
  title: id,
  boardColumn: TASK_COLUMNS.TODO,
  position: 0,
  estimateMinutes: 60,
  loggedMinutes: 0,
  assigneeId: null,
  assigneeName: null,
  attachmentCount: 0,
});

// A phase with all four columns, always - which is what the service returns
// and what makes an empty column a drop target.
const phase = (phaseId: string, phaseName: string, cards: Partial<Record<TaskColumn, TaskCardDTO[]>>) => ({
  phaseId,
  phaseName,
  position: 0,
  columns: TASK_COLUMN_ORDER.map((column) => ({ column, tasks: cards[column] ?? [] })),
});

const board: BoardDTO = {
  projectId: "project-1",
  canEditTasks: true,
  phases: [
    phase("phase-1", "Discovery", {
      [TASK_COLUMNS.TODO]: [card("task-a", "phase-1"), card("task-b", "phase-1")],
      [TASK_COLUMNS.BLOCKED]: [card("task-c", "phase-1")],
    }),
    phase("phase-2", "Build", {}),
  ],
};

describe("indexBoard", () => {
  it("locates a card by its phase, column and slot", () => {
    const { located } = indexBoard(board);

    expect(located.get("task-b")).toMatchObject({
      boardColumn: TASK_COLUMNS.TODO,
      phaseName: "Discovery",
      index: 1,
    });

    expect(located.get("task-c")).toMatchObject({
      boardColumn: TASK_COLUMNS.BLOCKED,
      index: 0,
    });
  });

  it("has nothing to say about a card the board does not hold", () => {
    expect(indexBoard(board).located.get("task-gone")).toBeUndefined();
  });

  it("appends past the last card of a column", () => {
    const { endPositionFor } = indexBoard(board);

    expect(endPositionFor("phase-1", TASK_COLUMNS.TODO)).toBe(2);
    expect(endPositionFor("phase-1", TASK_COLUMNS.BLOCKED)).toBe(1);
    // An empty column, and an empty phase: nought is the first slot, not a
    // missing answer.
    expect(endPositionFor("phase-1", TASK_COLUMNS.DONE)).toBe(0);
    expect(endPositionFor("phase-2", TASK_COLUMNS.TODO)).toBe(0);
  });

  it("answers nought for a phase that is no longer on the board", () => {
    expect(indexBoard(board).endPositionFor("phase-gone", TASK_COLUMNS.TODO)).toBe(0);
  });
});

describe("isSamePlace", () => {
  const { located } = indexBoard(board);

  it("recognises a card dropped on its own slot", () => {
    expect(
      isSamePlace(located.get("task-b"), {
        phaseId: "phase-1",
        boardColumn: TASK_COLUMNS.TODO,
        position: 1,
      }),
    ).toBe(true);
  });

  it("treats a different slot, column or phase as a real move", () => {
    const current = located.get("task-b");

    expect(isSamePlace(current, { phaseId: "phase-1", boardColumn: TASK_COLUMNS.TODO, position: 0 })).toBe(false);
    expect(isSamePlace(current, { phaseId: "phase-1", boardColumn: TASK_COLUMNS.DONE, position: 1 })).toBe(false);
    expect(isSamePlace(current, { phaseId: "phase-2", boardColumn: TASK_COLUMNS.TODO, position: 1 })).toBe(false);
  });

  it("does not swallow a move for a card it cannot find", () => {
    // The board has changed underneath. Sending it lets the service answer,
    // which is the whole point of not deciding here.
    expect(
      isSamePlace(undefined, { phaseId: "phase-1", boardColumn: TASK_COLUMNS.TODO, position: 0 }),
    ).toBe(false);
  });
});

describe("movePhaseOrder", () => {
  const phaseIds = ["a", "b", "c"];

  it("moves a phase one step and returns the whole order", () => {
    expect(movePhaseOrder(phaseIds, "b", -1)).toEqual(["b", "a", "c"]);
    expect(movePhaseOrder(phaseIds, "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("moves the last phase up and the first phase down", () => {
    expect(movePhaseOrder(phaseIds, "c", -1)).toEqual(["a", "c", "b"]);
    expect(movePhaseOrder(phaseIds, "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("refuses a move off either end rather than writing the same order", () => {
    expect(movePhaseOrder(phaseIds, "a", -1)).toBeNull();
    expect(movePhaseOrder(phaseIds, "c", 1)).toBeNull();
  });

  it("refuses a phase the board does not hold", () => {
    expect(movePhaseOrder(phaseIds, "gone", -1)).toBeNull();
  });

  it("leaves the list it was given alone", () => {
    const original = [...phaseIds];

    movePhaseOrder(phaseIds, "b", 1);

    expect(phaseIds).toEqual(original);
  });
});

// ===================================================================
// THE BOARD AS IT WILL BE.
//
// This is what lets a dragged card land where it was dropped instead of
// snapping back for a round trip. Every failure here looks like a working
// board that jumps: the browser draws one arrangement, the server saves
// another, and the correction arrives a second later as a card moving on
// its own.
//
// So the property that matters most is not "it moves the card" - it is that
// it moves the card to the SAME slot the service would, which is why both
// call placeIdAtPosition rather than each having a copy.
// ===================================================================
const idsIn = (result: BoardDTO, phaseId: string, column: TaskColumn) =>
  result.phases
    .find((phase) => phase.phaseId === phaseId)!
    .columns.find((c) => c.column === column)!
    .tasks.map((task) => task.id);

describe("applyMove", () => {
  it("moves a card to another column in the same phase", () => {
    const next = applyMove(board, "task-a", {
      phaseId: "phase-1",
      boardColumn: TASK_COLUMNS.IN_PROGRESS,
      position: 0,
    });

    expect(idsIn(next, "phase-1", TASK_COLUMNS.TODO)).toEqual(["task-b"]);
    expect(idsIn(next, "phase-1", TASK_COLUMNS.IN_PROGRESS)).toEqual(["task-a"]);
  });

  it("moves a card to another PHASE, and rewrites its phaseId", () => {
    // Left stale, the card would sit in a column whose own id disagrees with
    // the card in it - and the next indexBoard would locate it by the old
    // value, so the following drag would be computed against the wrong
    // column.
    const next = applyMove(board, "task-a", {
      phaseId: "phase-2",
      boardColumn: TASK_COLUMNS.TODO,
      position: 0,
    });

    expect(idsIn(next, "phase-1", TASK_COLUMNS.TODO)).toEqual(["task-b"]);
    expect(idsIn(next, "phase-2", TASK_COLUMNS.TODO)).toEqual(["task-a"]);

    const moved = next.phases[1].columns[0].tasks[0];
    expect(moved.phaseId).toBe("phase-2");
    expect(moved.boardColumn).toBe(TASK_COLUMNS.TODO);
  });

  it("REMOVES BEFORE INSERTING within one column, so a card does not land a slot short", () => {
    // The off-by-one this whole module exists for. Dragging the first card
    // to slot 1 with a naive insert leaves it exactly where it was, because
    // it is still occupying slot 0 while the index is computed.
    const next = applyMove(board, "task-a", {
      phaseId: "phase-1",
      boardColumn: TASK_COLUMNS.TODO,
      position: 1,
    });

    expect(idsIn(next, "phase-1", TASK_COLUMNS.TODO)).toEqual(["task-b", "task-a"]);
  });

  it("clamps a position past the end rather than dropping the card", () => {
    // The position is an index into a list the browser saw milliseconds ago.
    // A drop past the end of a column somebody else has emptied means
    // "last", and losing the card would be the worst possible answer.
    const next = applyMove(board, "task-c", {
      phaseId: "phase-1",
      boardColumn: TASK_COLUMNS.TODO,
      position: 99,
    });

    expect(idsIn(next, "phase-1", TASK_COLUMNS.TODO)).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("agrees with placeIdAtPosition, which is what stops the board jumping", () => {
    // The service orders the real rows with this exact function. If the two
    // ever disagreed the card would be drawn in one slot and saved in
    // another, and the refresh would move it without anybody touching it.
    for (const position of [0, 1, 2, 5]) {
      const next = applyMove(board, "task-c", {
        phaseId: "phase-1",
        boardColumn: TASK_COLUMNS.TODO,
        position,
      });

      expect(idsIn(next, "phase-1", TASK_COLUMNS.TODO)).toEqual(
        placeIdAtPosition(["task-a", "task-b"], "task-c", position),
      );
    }
  });

  it("renumbers positions so a SECOND drag reads a live index", () => {
    // Positions left stale would make the next move's arithmetic run against
    // where the cards used to be, which is how a board drifts a slot at a
    // time over several drags.
    const next = applyMove(board, "task-c", {
      phaseId: "phase-1",
      boardColumn: TASK_COLUMNS.TODO,
      position: 0,
    });

    expect(idsIn(next, "phase-1", TASK_COLUMNS.TODO)).toEqual(["task-c", "task-a", "task-b"]);
    expect(next.phases[0].columns[0].tasks.map((task) => task.position)).toEqual([0, 1, 2]);
  });

  it("leaves the board ALONE for a card it has never heard of", () => {
    // The board changed underneath - somebody else deleted it. Inventing a
    // card to satisfy the gesture would show work that does not exist; the
    // write still goes and the service answers about it.
    expect(applyMove(board, "task-missing", {
      phaseId: "phase-1",
      boardColumn: TASK_COLUMNS.DONE,
      position: 0,
    })).toBe(board);
  });

  it("never leaves a card in two columns at once", () => {
    const next = applyMove(board, "task-c", {
      phaseId: "phase-2",
      boardColumn: TASK_COLUMNS.DONE,
      position: 0,
    });

    const everywhere = next.phases.flatMap((phase) =>
      phase.columns.flatMap((column) => column.tasks.map((task) => task.id)),
    );

    expect(everywhere.filter((id) => id === "task-c")).toHaveLength(1);
  });

  it("does not mutate the board it was given", () => {
    // The optimistic value and the props are the same object graph
    // otherwise, and React would not re-render a mutation anyway.
    const before = JSON.stringify(board);

    applyMove(board, "task-a", { phaseId: "phase-2", boardColumn: TASK_COLUMNS.DONE, position: 0 });

    expect(JSON.stringify(board)).toBe(before);
  });
});
