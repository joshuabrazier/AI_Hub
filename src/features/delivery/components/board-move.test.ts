import { describe, expect, it } from "vitest";

import { TASK_COLUMNS, TASK_COLUMN_ORDER, type TaskColumn } from "@/lib/data/kysely-database-types";

import type { BoardDTO, TaskCardDTO } from "../delivery.types";
import { indexBoard, isSamePlace, movePhaseOrder } from "./board-move";

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
