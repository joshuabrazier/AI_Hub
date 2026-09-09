import { describe, expect, it } from "vitest";

import { TASK_COLUMNS } from "@/lib/data/kysely-database-types";

import type { BoardDTO, ProjectSummaryDTO } from "../delivery.types";
import {
  buildTimesheetCatalogue,
  findCatalogueProjectForTask,
  findCatalogueTask,
} from "./timesheet-catalogue";

// -------------------------------------------------------------------
// What the timesheet's pickers are allowed to offer.
//
// The failures here are all quiet ones: a task that never appears in the
// picker looks like a project nobody set up, and a `canEditTasks` that comes
// out true for somebody who is not a lead is a button the server refuses.
// Both are worth a test because neither throws.
// -------------------------------------------------------------------

const project = (over: Partial<ProjectSummaryDTO> = {}): ProjectSummaryDTO => ({
  id: "project-1",
  title: "Migration",
  clientId: "client-1",
  clientName: "Perks",
  status: "active",
  isBillable: true,
  canEditTasks: false,
  ...over,
});

const board = (over: Partial<BoardDTO> = {}): BoardDTO => ({
  projectId: "project-1",
  canEditTasks: false,
  phases: [
    {
      phaseId: "phase-1",
      phaseName: "Discovery",
      position: 0,
      columns: [
        {
          column: TASK_COLUMNS.TODO,
          tasks: [
            {
              id: "task-1",
              phaseId: "phase-1",
              title: "Workshop",
              boardColumn: TASK_COLUMNS.TODO,
              position: 0,
              estimateMinutes: 480,
              loggedMinutes: 60,
              assigneeId: null,
              assigneeName: null,
              attachmentCount: 0,
            },
          ],
        },
        {
          column: TASK_COLUMNS.DONE,
          tasks: [
            {
              id: "task-2",
              phaseId: "phase-1",
              title: "Kick-off",
              boardColumn: TASK_COLUMNS.DONE,
              position: 0,
              estimateMinutes: 120,
              loggedMinutes: 120,
              assigneeId: null,
              assigneeName: null,
              attachmentCount: 2,
            },
          ],
        },
      ],
    },
  ],
  ...over,
});

describe("buildTimesheetCatalogue", () => {
  it("flattens a phase's columns into one list of tasks, in board order", () => {
    const catalogue = buildTimesheetCatalogue([project()], [board()]);

    expect(catalogue.projects).toHaveLength(1);
    expect(catalogue.projects[0].phases[0].tasks.map((task) => task.taskId)).toEqual(["task-1", "task-2"]);
  });

  it("keeps a done task, because writing up on Monday what was finished on Friday is ordinary", () => {
    const catalogue = buildTimesheetCatalogue([project()], [board()]);
    const done = catalogue.projects[0].phases[0].tasks.find((task) => task.taskId === "task-2");

    expect(done?.boardColumn).toBe(TASK_COLUMNS.DONE);
  });

  it("carries the estimate and the logged total, which the estimate dialog reads", () => {
    const catalogue = buildTimesheetCatalogue([project()], [board()]);
    const task = catalogue.projects[0].phases[0].tasks[0];

    expect(task.estimateMinutes).toBe(480);
    expect(task.loggedMinutes).toBe(60);
    expect(task.phaseName).toBe("Discovery");
  });

  // The board's answer, never the project summary's: they are the same rule
  // and only one of them was resolved against THIS project's membership row.
  it("takes canEditTasks from the board read", () => {
    const catalogue = buildTimesheetCatalogue(
      [project({ canEditTasks: false })],
      [board({ canEditTasks: true })],
    );

    expect(catalogue.projects[0].canEditTasks).toBe(true);
  });

  it("drops a project whose board is missing rather than offering an empty picker", () => {
    const catalogue = buildTimesheetCatalogue([project(), project({ id: "project-2" })], [board()]);

    expect(catalogue.projects.map((option) => option.projectId)).toEqual(["project-1"]);
  });
});

describe("findCatalogueTask", () => {
  it("finds a task and the project it is on", () => {
    const catalogue = buildTimesheetCatalogue([project()], [board()]);

    expect(findCatalogueTask(catalogue, "task-2")?.title).toBe("Kick-off");
    expect(findCatalogueProjectForTask(catalogue, "task-2")?.projectId).toBe("project-1");
  });

  // A timesheet row can name a task on a project somebody has since been
  // taken off - their own history. Null is the ordinary answer, and the
  // screen shows the row without an estimate rather than breaking.
  it("answers null for a task the catalogue does not carry", () => {
    const catalogue = buildTimesheetCatalogue([project()], [board()]);

    expect(findCatalogueTask(catalogue, "task-elsewhere")).toBeNull();
    expect(findCatalogueProjectForTask(catalogue, "task-elsewhere")).toBeNull();
  });
});
