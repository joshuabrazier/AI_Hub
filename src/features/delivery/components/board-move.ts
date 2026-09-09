import type { TaskColumn } from "@/lib/data/kysely-database-types";

import { placeIdAtPosition, type BoardDTO, type TaskCardDTO } from "../delivery.types";

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

// -------------------------------------------------------------------
// THE BOARD AS IT WILL BE, so a drag can be drawn before the server answers.
//
// WHY THIS EXISTS. A move used to await the action and then router.refresh(),
// which means the card stayed where it was for a whole round trip plus a
// re-render - and after a DRAG that is unmistakable: the gesture ends, the
// card snaps back to where it came from, and some time later it appears
// where it was dropped. People read that as the board being broken, and drag
// the card again.
//
// So the workspace applies this immediately and sends the write behind it.
// The optimistic value is discarded when the refresh lands, so the server
// remains the authority and a refusal simply puts the card back.
//
// IT USES placeIdAtPosition, THE SERVICE'S OWN RULE, imported rather than
// reimplemented. That is the whole reason that function moved out of a
// server-only file: two implementations of where a dropped card lands is how
// the card the browser shows ends up one slot from the card the server saved,
// and the correction arrives as a visible jump a second later.
//
// A CARD CAN CHANGE PHASE AS WELL AS COLUMN, so the copy written into the
// destination gets the destination's `phaseId`. Leaving it would put a card
// in a column whose own id disagrees with the card in it - which the next
// `indexBoard` would then locate by the stale value.
//
// AN UNKNOWN CARD LEAVES THE BOARD ALONE. The board has changed underneath -
// somebody else deleted it - and inventing a card to satisfy the gesture
// would show work that does not exist. The write still goes, and the service
// answers about it.
// -------------------------------------------------------------------
export function applyMove(board: BoardDTO, taskId: string, destination: BoardPlacement): BoardDTO {
  let moved: TaskCardDTO | undefined;

  for (const phase of board.phases) {
    for (const column of phase.columns) {
      const found = column.tasks.find((task) => task.id === taskId);
      if (found) moved = found;
    }
  }

  if (!moved) return board;

  // The card as it will be once it lands. `position` is set from the slot
  // rather than left stale, so a second drag of the same card reads the
  // index it is actually at.
  const landing: TaskCardDTO = {
    ...moved,
    phaseId: destination.phaseId,
    boardColumn: destination.boardColumn,
  };

  return {
    ...board,
    phases: board.phases.map((phase) => ({
      ...phase,
      columns: phase.columns.map((column) => {
        const isDestination =
          phase.phaseId === destination.phaseId && column.column === destination.boardColumn;

        // Everywhere else: drop the card if it was here. Unconditional
        // rather than guarded on the source, because a card in two columns
        // for one render is worse than a wasted filter.
        if (!isDestination) {
          const tasks = column.tasks.filter((task) => task.id !== taskId);

          return tasks.length === column.tasks.length
            ? column
            : { ...column, tasks: renumber(tasks) };
        }

        // The destination: the same ordered-id rule the service applies,
        // then the cards back in that order.
        const byId = new Map(column.tasks.map((task) => [task.id, task]));
        byId.set(taskId, landing);

        const order = placeIdAtPosition(
          column.tasks.map((task) => task.id),
          taskId,
          destination.position,
        );

        return {
          ...column,
          tasks: renumber(order.flatMap((id) => {
            const task = byId.get(id);
            return task ? [task] : [];
          })),
        };
      }),
    })),
  };
}

/** Positions to match the array, so a second drag reads a live index. */
function renumber(tasks: readonly TaskCardDTO[]): TaskCardDTO[] {
  return tasks.map((task, position) => (task.position === position ? task : { ...task, position }));
}
