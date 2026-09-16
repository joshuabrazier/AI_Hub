import { userDisplayName } from "@/lib/user-display-name";

import type { PhaseDTO, ProjectMemberDTO } from "../delivery.types";

// ===================================================================
// WHAT A FINISHED SETUP STEP SAYS ABOUT ITSELF
//
// Each step of project setup collapses to one line once it is done, and that
// line is the ANSWER to the step's question rather than a count of what is
// in it. "Louis leading, and 3 others" is readable without opening anything;
// "4 members" is a number you have to go and interpret, which is most of the
// reason the old page had three panels open at once.
//
// PURE AND TESTED BECAUSE THIS IS WHERE PROSE GOES WRONG QUIETLY. A missing
// plural, a lead who is not there, an account that was de-identified and has
// no name - none of those throw, they just print something slightly stupid
// on an admin's screen and nobody mentions it. They are cheap to assert and
// impossible to notice.
// ===================================================================

// ===================================================================
// TWO DIFFERENT QUESTIONS, AND THEY USED TO SHARE ONE FLAG.
//
//   isComplete  has somebody SETTLED this step? It ticks the step, and it
//               decides which step the page opens on.
//   missing     what does the BOARD still lack? It feeds the "not ready
//               yet" line, and a project can be perfectly usable with a
//               step nobody has settled.
//
// They were the same boolean until the creator started being added to their
// own project automatically. That one row made a brand new project look like
// its People step was finished - ticked, collapsed, and the page skipping
// straight past it to Phases - when nobody had chosen a team at all.
// ===================================================================
export type SetupStepSummary = {
  summary: string;
  isComplete: boolean;
  /** What the BOARD still lacks because of this step, or null if nothing. */
  missing: string | null;
};

// -------------------------------------------------------------------
// People.
//
// A LEAD IS PART OF BEING USABLE, and this is the only place that says so.
// canEditProjectTasks turns on being an admin or being the lead, so a
// project with four people and nobody leading has a board only an admin can
// change - while a member list with four rows in it looks entirely finished.
//
// ONE PERSON IS NOT A SETTLED TEAM. Creating a project puts the creator on
// it as lead, so every new project arrives here with exactly one member that
// nobody chose. Treating that as done ticked the step before anybody had
// looked at it. So one member leaves the step OPEN and UNTICKED - "there
// could be more people on this" is the whole point of the step.
//
// It does NOT make the board unready, which is the reason `missing` is its
// own field. A project with one lead and some phases works perfectly well;
// somebody genuinely working alone should not be told their board is
// incomplete for ever, they should just see a step they have not ticked off.
// -------------------------------------------------------------------
export function describeTeam(members: readonly ProjectMemberDTO[]): SetupStepSummary {
  const lead = members.find((member) => member.isLead);

  if (members.length === 0) {
    return { summary: "Nobody on it yet", isComplete: false, missing: "a lead" };
  }

  if (!lead) {
    return {
      summary: `${members.length} ${members.length === 1 ? "person" : "people"}, but nobody leading yet`,
      isComplete: false,
      missing: "a lead",
    };
  }

  // De-identifying a dormant account keeps its project membership and drops
  // its name, so a real lead can have none.
  const leadName = userDisplayName(lead) ?? "Somebody";
  const others = members.length - 1;

  if (others === 0) {
    return {
      // Phrased as a position rather than a verdict. "Working alone" read as
      // a settled answer, which is exactly what it is not yet.
      summary: `${leadName} leading, nobody else on it yet`,
      isComplete: false,
      missing: null,
    };
  }

  return {
    summary: `${leadName} leading, and ${others} ${others === 1 ? "other" : "others"}`,
    isComplete: true,
    missing: null,
  };
}

// How many phase names to print before the line stops being readable. Four
// short names fit; a fifth is where it starts wrapping on a normal window,
// and a wrapped summary defeats the point of collapsing the step.
const MAX_NAMED_PHASES = 4;

// -------------------------------------------------------------------
// Phases.
//
// NAMED, NOT COUNTED. Three phase names are the clearest possible
// description of how a board is laid out, and shorter than the sentence
// saying there are three of them.
// -------------------------------------------------------------------
export function describePhases(phases: readonly PhaseDTO[]): SetupStepSummary {
  if (phases.length === 0) {
    return { summary: "No phases yet, so the board has nowhere to put a task", isComplete: false, missing: "a phase" };
  }

  const names = phases.map((phase) => phase.name);

  if (names.length <= MAX_NAMED_PHASES) {
    return { summary: names.join(", "), isComplete: true, missing: null };
  }

  const shown = names.slice(0, MAX_NAMED_PHASES - 1);

  return {
    summary: `${shown.join(", ")} and ${names.length - shown.length} more`,
    isComplete: true,
    missing: null,
  };
}

// -------------------------------------------------------------------
// Pooled budgets.
//
// THE EMPTY CASE IS NOT A GAP, and the wording has to say so. Pooling is
// something a minority of projects do, and an empty step that reads like an
// unfinished one is how somebody ends up creating a "pool" containing one
// person to make the screen look complete.
// -------------------------------------------------------------------
export function describeBudgetPools(pools: readonly { name: string }[]): string {
  if (pools.length === 0) return "Nobody's time is pooled, which suits most projects";

  return pools.map((pool) => pool.name).join(", ");
}

// -------------------------------------------------------------------
// What is still missing, named in the order the steps ask for it.
//
// "Setup is incomplete" sends somebody back through all of it. Naming the
// two things means they can go straight to the one that is not done.
//
// IT READS `missing` RATHER THAN `isComplete`, and the difference is the
// whole reason that field exists. An unticked step is not automatically a
// broken board: a project with one lead and some phases is usable, and its
// People step is unticked only because nobody has confirmed who else is on
// it. Asking the completeness flag here would have told somebody working
// alone that their board needed "a lead" while they were looking at
// themselves listed as the lead.
// -------------------------------------------------------------------
export function missingForBoard(team: SetupStepSummary, phases: SetupStepSummary): string[] {
  return [team.missing, phases.missing].filter((item): item is string => item !== null);
}
