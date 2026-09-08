import type { TaskColumn } from "@/lib/data/kysely-database-types";

import type { BoardDTO, ProjectSummaryDTO } from "../delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// WHAT THE TIMESHEET'S PICKERS AND ITS ESTIMATE DIALOG CAN CHOOSE FROM
// ===================================================================
//
// The grid renders a WEEK, and a week only knows about tasks that already
// have time on them. Two of its controls need the other half - every task
// the person could log to - and neither can ask for it themselves:
//
//   ADDING A ROW is project, then phase, then task, so the picker needs the
//   whole tree before the first click.
//   ADJUSTING AN ESTIMATE from a cell needs the task's current estimate, and
//   for a transfer, the OTHER tasks on the same project with theirs.
//
// So the page reads it server-side and hands it down. There is no read
// action on the board service - the delivery actions are writes plus the
// grid's own two entry points - and a client component cannot call a
// service, so a lazily-loaded catalogue is not available to build.
//
// IT IS TRIMMED HERE RATHER THAN SHIPPED WHOLE. A BoardDTO carries assignee
// names, positions, attachment counts and four columns per phase; a picker
// needs a title and two figures. Trimming on the server keeps the flight
// payload to what the screen renders, which for somebody on eight projects
// is the difference between a list and a board dump.
//
// EVERY FIGURE IN IT IS THE SERVER'S. `canEditTasks` in particular is
// BoardDTO's own field - lead or admin, decided once in the service - and is
// carried through unchanged. A component deciding it from a role would be a
// second copy of an authorization rule, and the two would disagree the first
// time either moved.
// -------------------------------------------------------------------

export type TimesheetTaskOption = {
  taskId: string;
  title: string;
  phaseId: string;
  phaseName: string;
  // Which column the card sits in. Shown beside a done task in the picker,
  // because a done task is still a legitimate thing to log an hour against -
  // writing up on Monday what was finished on Friday - and it should be
  // recognisable rather than hidden.
  boardColumn: TaskColumn;
  estimateMinutes: number;
  loggedMinutes: number;
};

export type TimesheetPhaseOption = {
  phaseId: string;
  name: string;
  tasks: TimesheetTaskOption[];
};

export type TimesheetProjectOption = {
  projectId: string;
  title: string;
  clientName: string;
  // Lead or admin, on THIS project. Straight off the board read.
  canEditTasks: boolean;
  phases: TimesheetPhaseOption[];
};

export type TimesheetCatalogueDTO = {
  projects: TimesheetProjectOption[];
};

// -------------------------------------------------------------------
// Fold the boards into the projects they belong to.
//
// PURE, and it takes both halves rather than reading anything: the projects
// come from getMyProjectsService (memberships, archived ones already out)
// and the boards from getProjectBoardService, both of which have already
// authorised the caller. Nothing here decides who sees what.
//
// A project whose board is missing is DROPPED rather than rendered empty. It
// can only happen if the two reads disagreed - somebody was removed from a
// project between them - and an entry with no tasks under it is a picker
// that opens onto nothing.
// -------------------------------------------------------------------
export function buildTimesheetCatalogue(
  projects: readonly ProjectSummaryDTO[],
  boards: readonly BoardDTO[],
): TimesheetCatalogueDTO {
  const boardsByProject = new Map(boards.map((board) => [board.projectId, board]));

  const options: TimesheetProjectOption[] = [];

  for (const project of projects) {
    const board = boardsByProject.get(project.id);

    if (!board) continue;

    const phases: TimesheetPhaseOption[] = board.phases.map((phase) => ({
      phaseId: phase.phaseId,
      name: phase.phaseName,
      // Flattened in TASK_COLUMN_ORDER, which is the order the board itself
      // reads in, so a task is where somebody expects to find it.
      tasks: phase.columns.flatMap((column) =>
        column.tasks.map((task) => ({
          taskId: task.id,
          title: task.title,
          phaseId: phase.phaseId,
          phaseName: phase.phaseName,
          boardColumn: task.boardColumn,
          estimateMinutes: task.estimateMinutes,
          loggedMinutes: task.loggedMinutes,
        })),
      ),
    }));

    options.push({
      projectId: project.id,
      title: project.title,
      clientName: project.clientName,
      canEditTasks: board.canEditTasks,
      phases,
    });
  }

  return { projects: options };
}

/** The project a task belongs to, or null when the catalogue does not carry it. */
export function findCatalogueProjectForTask(
  catalogue: TimesheetCatalogueDTO,
  taskId: string,
): TimesheetProjectOption | null {
  for (const project of catalogue.projects) {
    for (const phase of project.phases) {
      if (phase.tasks.some((task) => task.taskId === taskId)) return project;
    }
  }

  return null;
}

// -------------------------------------------------------------------
// One task, or null.
//
// NULL IS AN ORDINARY ANSWER HERE, not an error. A timesheet row can name a
// task on a project the person has since been taken off: the week shows it
// because the hours are their own history, while the catalogue only carries
// projects they are on today. The screen degrades - no estimate figure, no
// adjust control - rather than pretending.
// -------------------------------------------------------------------
export function findCatalogueTask(
  catalogue: TimesheetCatalogueDTO,
  taskId: string,
): TimesheetTaskOption | null {
  for (const project of catalogue.projects) {
    for (const phase of project.phases) {
      const task = phase.tasks.find((candidate) => candidate.taskId === taskId);

      if (task) return task;
    }
  }

  return null;
}
