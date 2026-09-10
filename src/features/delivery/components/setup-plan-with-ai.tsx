"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Check, Loader2, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES } from "@/lib/constants";
import { MAX_BRIEF_CHARS } from "@/lib/delivery/project-plan.prompt";
import type { ResolvedProjectPlan } from "@/lib/delivery/project-plan";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { applyProjectPlanAction, draftProjectPlanAction } from "../project-plan.actions";

// ===================================================================
// PASTE THE BRIEF, READ WHAT IT UNDERSTOOD, CREATE IT
//
// Setting a project up by hand is a form, then three panels, then a board
// with no cards on it - twenty minutes of typing that already exists as
// prose in the email that started the job. This takes the prose.
//
// IT PROPOSES AND NEVER DECIDES, which is the same shape as filing a meeting
// note and for a stronger reason: this creates a client, a project, its
// phases, every task and who each is assigned to. A model reading a brief
// gets things wrong in ways that read as right - a task assigned to the
// wrong colleague, the whole budget landing on one line - so the plan is
// shown in full before anything is written, and the things it could not work
// out are shown loudest.
//
// THE REVIEW IS THE PRODUCT. It would be shorter to show "12 tasks, 204
// hours" and a Create button, and that would train people to click it.
// Every task, its estimate and its assignee are listed, because the question
// somebody is actually answering is "is that right", and a total cannot
// answer it.
//
// WARNINGS ABOVE THE PLAN, BLOCKERS INSTEAD OF THE BUTTON. A warning is
// something to read and accept; a blocker is a plan that cannot be applied,
// and offering a disabled button with a tooltip is a worse way of saying so
// than not offering one.
// ===================================================================
export function SetupPlanWithAi() {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState<ResolvedProjectPlan | null>(null);
  const [isDrafting, startDrafting] = useTransition();
  const [isCreating, startCreating] = useTransition();

  const draft = () =>
    startDrafting(async () => {
      try {
        const response = await draftProjectPlanAction(brief);

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setPlan(response.data ?? null);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const create = () =>
    startCreating(async () => {
      if (!plan) return;

      try {
        const response = await applyProjectPlanAction(plan);

        if (!response.success || !response.data) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success("Project created.");

        // Straight to setup rather than the board: a plan leaves rate bands
        // unset and often no lead, and setup is the screen that says which
        // of those is still missing.
        router.push(ROUTES.adminProjectSetup(response.data.projectId));
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  if (!isOpen) {
    return (
      <div className="mb-6 rounded-xl border border-dashed border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles size={15} className="text-muted-foreground" aria-hidden="true" />
              Start from a brief
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Paste the scope, the budget and the tasks. You will see what it understood before anything is
              created.
            </p>
          </div>

          <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
            <Wand2 size={14} aria-hidden="true" />
            Create with AI
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-border">
      <div className="border-b border-border p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles size={15} className="text-muted-foreground" aria-hidden="true" />
          Start from a brief
        </p>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          An email, a scope of work, a quote, or a few lines of your own. Say who the client is, what it was
          sold for, and what the work is.
        </p>
      </div>

      <div className="space-y-3 p-4">
        <Textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          rows={8}
          maxLength={MAX_BRIEF_CHARS}
          disabled={isDrafting || isCreating}
          aria-label="The project brief"
          placeholder={
            "New project for Perks, the Xero migration. Sold at 250 hours.\n\n" +
            "One phase, Build:\n" +
            "- scope the chart of accounts, 16h, Louis\n" +
            "- export the legacy ledger, 24h, Josh\n" +
            "- build the importer, 80h, Josh"
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={draft} disabled={!brief.trim() || isDrafting || isCreating}>
            {isDrafting ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 size={14} aria-hidden="true" />
            )}
            {plan ? "Read it again" : "Read the brief"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setIsOpen(false);
              setPlan(null);
            }}
            disabled={isDrafting || isCreating}
          >
            Cancel
          </Button>

          {/* Said while it is happening, because reading a long brief is a
              model call and several seconds of a still button reads as a
              page that has stopped. */}
          {isDrafting && (
            <span className="text-sm text-muted-foreground">Reading the brief. This takes a moment.</span>
          )}
        </div>

        {plan && <PlanReview plan={plan} onCreate={create} isCreating={isCreating} />}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// What it understood, in full.
// -------------------------------------------------------------------
function PlanReview({
  plan,
  onCreate,
  isCreating,
}: {
  plan: ResolvedProjectPlan;
  onCreate: () => void;
  isCreating: boolean;
}) {
  const hasBlockers = plan.blockers.length > 0;

  return (
    <div className="mt-4 rounded-lg border border-border">
      {/* BLOCKERS FIRST AND LOUDEST. Nothing below matters while one of
          these stands. */}
      {hasBlockers && (
        <div className="border-b border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <TriangleAlert size={14} className="text-destructive" aria-hidden="true" />
            This cannot be created yet
          </p>
          <ul className="mt-2 space-y-1">
            {plan.blockers.map((blocker) => (
              <li key={blocker} className="break-words text-sm text-muted-foreground">
                {blocker}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.warnings.length > 0 && (
        <div className="border-b border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">Worth checking</p>
          <ul className="mt-2 space-y-1">
            {plan.warnings.map((warning) => (
              <li key={warning} className="break-words text-sm text-muted-foreground">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-base font-medium text-foreground">{plan.project.title}</span>
          <span className="text-sm text-muted-foreground">
            for {plan.client.name}
            {plan.client.mode === "new" ? " (a new client)" : ""}
          </span>
          {!plan.project.isBillable && (
            <span className="text-xs text-muted-foreground">Not billable</span>
          )}
        </div>

        {/* The arithmetic, done here and never by the model. */}
        <p className="text-sm text-muted-foreground">
          {plan.totals.taskCount} task{plan.totals.taskCount === 1 ? "" : "s"} across{" "}
          {plan.totals.phaseCount} phase{plan.totals.phaseCount === 1 ? "" : "s"},{" "}
          {formatHours(plan.totals.estimateHours)}
          {plan.totals.budgetHours === null
            ? " with no budget given"
            : ` of ${formatHours(plan.totals.budgetHours)}`}
          .
        </p>

        {plan.phases.map((phase) => (
          <div key={phase.name}>
            <p className="text-sm font-medium text-foreground">{phase.name}</p>

            {phase.tasks.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No tasks in this phase.</p>
            ) : (
              <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                {phase.tasks.map((task, index) => (
                  // Indexed as well as titled: two tasks can legitimately
                  // share a name across a long plan.
                  <li
                    key={`${task.title}-${index}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span className="min-w-0 break-words text-sm text-foreground">{task.title}</span>
                    <span className="flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground">
                      {/* WHO IT WENT TO, or that it went to nobody. A blank
                          here would read as "unassigned on purpose". */}
                      <span>
                        {task.assigneeId ? task.assigneeName : "Unassigned"}
                      </span>
                      <span className="tabular-nums">{formatHours(task.estimateHours)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {plan.members.length > 0 && (
          <p className="text-sm text-muted-foreground">
            On the project:{" "}
            {plan.members
              .map((member) => `${member.name}${member.isLead ? " (lead)" : ""}`)
              .join(", ")}
            .
          </p>
        )}

        {!hasBlockers && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="button" onClick={onCreate} disabled={isCreating} loading={isCreating}>
              <Check size={14} aria-hidden="true" />
              Create this project
            </Button>
            <span className="text-xs text-muted-foreground">
              Nothing has been created yet. Rate bands are not set from a brief.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// One decimal, no trailing ".0". An estimate reads as a quantity somebody
// chose, and "8.0 hours" reads as a machine.
function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;

  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
}
