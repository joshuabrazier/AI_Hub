import type { TaskColumn } from "@/lib/data/kysely-database-types";

import type { BoardDTO, TaskCardDTO } from "../delivery.types";

// -------------------------------------------------------------------
// The board's arithmetic, away from the components that draw it.
//
// Three questions, all of them about the WHOLE board rather than about one
// column: where a card is now, how long a destination column is, and what
// the phase order becomes when one phase moves a step. A column can only
// see itself, so none of them can be answered where they are asked.
//
// PURE AND TESTED DIRECTLY, because every interesting case is an
// off-by-one - a card dropped where it already is, a phase already at the
// top, a menu appending to a column it cannot see. Each of those failures
// looks like a working board: the card lands one slot from where it was let
// go, or a "move up" writes the order that is already stored. That is why
// this is a module with a test rather than four lines inside a component.
//
// NO REACT AND NO ACTIONS HERE. It decides where something should go; the
// workspace sends it, and the service re-checks and clamps whatever
// arrives - a position from this file is a suggestion, not an authority.
// -------------------------------------------------------------------

/** Which phase, which column, which slot - the shape MoveTaskSchema takes. */
export type BoardPlacement = {
  phaseId: string;
  boardColumn: TaskColumn;
  position: number;
};

/** A card, plus the two facts the board knows about it that it does not carry. */
export type LocatedTask = {
  task: TaskCardDTO;
  boardColumn: TaskColumn;
  phaseName: string;
  /** Its slot in its column, which is what "move up" and "move down" mean. */
  index: number;
};

export type BoardIndex = {
  located: Map<string, LocatedTask>;
  /**
   * The slot AFTER the last card of a column, which is where a menu move
   * appends. Nought for a column that does not exist - a phase deleted in
   * another tab - because appending to the start of an empty column is the
   * harmless answer and the service clamps regardless.
   */
  endPositionFor: (phaseId: string, boardColumn: TaskColumn) => number;
};

const columnKey = (phaseId: string, boardColumn: TaskColumn) => `${phaseId}:${boardColumn}`;

/** One pass over the board, so nothing downstream scans it per card. */
export function indexBoard(board: BoardDTO): BoardIndex {
  const located = new Map<string, LocatedTask>();
  const lengths = new Map<string, number>();

  for (const phase of board.phases) {
    for (const column of phase.columns) {
      lengths.set(columnKey(phase.phaseId, column.column), column.tasks.length);

      column.tasks.forEach((task, index) => {
        located.set(task.id, {
          task,
          boardColumn: column.column,
          phaseName: phase.phaseName,
          index,
        });
      });
    }
  }

  return {
    located,
    endPositionFor: (phaseId, boardColumn) => lengths.get(columnKey(phaseId, boardColumn)) ?? 0,
  };
}

// -------------------------------------------------------------------
// Is this card already where it is being sent?
//
// A drop on the card's own slot is the commonest gesture on a board -
// somebody picks a card up and changes their mind - and sending it would
// renumber a whole column into the order it is already in. Unknown is NOT
// "the same place": a card the index has never heard of is one the board
// has changed under, and the move is worth attempting so the service can
// answer.
// -------------------------------------------------------------------
export function isSamePlace(current: LocatedTask | undefined, destination: BoardPlacement): boolean {
  if (!current) return false;

  return (
    current.task.phaseId === destination.phaseId &&
    current.boardColumn === destination.boardColumn &&
    current.index === destination.position
  );
}

// -------------------------------------------------------------------
// The phase order after one phase moves a step, as the WHOLE list.
//
// That is the shape ReorderPhasesSchema takes and the reason it is
// idempotent: replaying the list produces the same order, where "move this
// one up" has to be re-interpreted against whatever the server currently
// holds and two people nudging at once resolve it differently.
//
// NULL means the move is not possible - an unknown phase, or one already at
// the end it is being pushed towards - and the caller does nothing. Not an
// empty list, which the schema would refuse, and not the unchanged list,
// which would write a no-op and toast as though something had happened.
// -------------------------------------------------------------------
export function movePhaseOrder(
  phaseIds: readonly string[],
  phaseId: string,
  direction: -1 | 1,
): string[] | null {
  const from = phaseIds.indexOf(phaseId);

  if (from < 0) return null;

  const to = from + direction;

  if (to < 0 || to >= phaseIds.length) return null;

  const reordered = [...phaseIds];

  reordered.splice(from, 1);
  reordered.splice(to, 0, phaseId);

  return reordered;
}
