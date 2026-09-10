import { describe, expect, it } from "vitest";

import { describeTaskEffort } from "./delivery.types";

// ===================================================================
// WHAT A BOARD CARD SAYS ABOUT ITS EFFORT
//
// This is the one string on a card that is derived rather than typed, and it
// is read across a hundred cards at a glance, so the properties worth
// holding are about SCANNING rather than about arithmetic:
//
//   - a card with an estimate always reads `logged / estimate`, in that
//     order, whatever the figures are - a form that changes shape has to be
//     re-parsed on every card
//   - no estimate is never rendered as a zero estimate, here as everywhere
//     else in the module
//   - `short` is never the only thing said, because it is not
//     self-describing - the card hides it from assistive tech and reads
//     `full` instead, so `full` has to stand alone
// ===================================================================
describe("describeTaskEffort", () => {
  it("reads logged over estimate, in that order", () => {
    const effort = describeTaskEffort(480, 360);

    expect(effort.short).toBe("6h / 8h");
    expect(effort.full).toBe("6h logged of 8h estimated");
    expect(effort.isOverBudget).toBe(false);
  });

  // The case four fifths of a board is in. It keeps the ratio form rather
  // than collapsing to a bare "8h", which would read as the logged figure
  // on a card whose neighbours all show `logged / estimate`.
  it("keeps the ratio form on a card nobody has logged against", () => {
    expect(describeTaskEffort(480, 0).short).toBe("0m / 8h");
    expect(describeTaskEffort(480, 0).full).toBe("0m logged of 8h estimated");
  });

  it("says by how much a card is over, and flags it for colouring", () => {
    const effort = describeTaskEffort(480, 630);

    expect(effort.short).toBe("10h 30m / 8h");
    expect(effort.full).toBe("10h 30m logged of 8h estimated, 2h 30m over");
    expect(effort.isOverBudget).toBe(true);
  });

  // Exactly on the estimate is not over it. The boundary is the same one
  // budgetProgress draws (`remaining < 0`), and a card at exactly its
  // estimate turning red would cry wolf on every finished task.
  it("does not call a card that is exactly on its estimate over", () => {
    expect(describeTaskEffort(480, 480).isOverBudget).toBe(false);
  });

  describe("with no estimate", () => {
    it("says so rather than showing a ratio against nought", () => {
      const effort = describeTaskEffort(0, 0);

      expect(effort.short).toBe("No estimate");
      expect(effort.full).toBe("No estimate, and no time logged yet");
      expect(effort.isOverBudget).toBe(false);
    });

    // Unestimated work with hours against it cannot be over budget, because
    // there is no budget. Reporting it as over would be an invented figure.
    it("shows the hours and never calls them over budget", () => {
      const effort = describeTaskEffort(0, 150);

      expect(effort.short).toBe("2h 30m logged");
      expect(effort.full).toBe("2h 30m logged, against no estimate");
      expect(effort.isOverBudget).toBe(false);
    });
  });

  // The DTO is built from Postgres integers so neither should ever arrive
  // negative, but a caller doing its own subtraction could hand one over,
  // and "-2h / 8h" on a card is worse than treating it as nothing.
  it("floors a negative to nothing rather than rendering a minus", () => {
    expect(describeTaskEffort(-60, -30).short).toBe("No estimate");
  });

  // Every branch has to produce a sentence, because the card shows `full`
  // to a screen reader INSTEAD of `short` rather than as well as it.
  it("always produces a full sentence that stands on its own", () => {
    const cases = [
      [0, 0],
      [0, 90],
      [480, 0],
      [480, 300],
      [480, 480],
      [480, 700],
    ] as const;

    for (const [estimate, logged] of cases) {
      const { full } = describeTaskEffort(estimate, logged);

      expect(full.length).toBeGreaterThan(`${estimate}`.length);
      expect(full).toMatch(/estimate/);
    }
  });
});
