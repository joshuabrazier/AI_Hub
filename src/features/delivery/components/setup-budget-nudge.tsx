"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { markProjectBudgetAssignedAction } from "../delivery-setup.actions";
import { budgetProgress, formatMinutesAsClock, type BudgetGroupReportDTO } from "../delivery.types";
import { SetupBudgetBar } from "./setup-budget-bar";

// -------------------------------------------------------------------
// "HOW MUCH OF THE BUDGET HAS BEEN ASSIGNED TO TASKS" - shown on the BOARD.
//
// IT USED TO BE ON PROJECT SETUP, and the move is worth recording because
// the name still says Setup. What it measures is the total of the TASK
// ESTIMATES against the budgeted pool, and there are no tasks on the setup
// screen - a project reaches it with none, and the board is where they are
// made. So it sat at the top of setup reading 0% assigned, on every project,
// until somebody went and did the work somewhere else. Here it has something
// to say, and it is where the person who has just finished estimating
// already is.
//
// STILL ADMIN-ONLY. The button calls markProjectBudgetAssignedService, which
// guards on admin, so the board page renders this for admins alone - a lead
// offered the button would be offered a refusal.
//
// A ONE-TIME NUDGE, NOT A RULE, and the whole shape of this component comes
// from that one sentence.
//
// WHETHER IT SHOWS IS THE SERVER'S ANSWER, and this component does not have
// a second opinion: `budgetAssignedAt` is null until somebody has finished
// planning once, the repository only ever writes it while it is still null,
// and nothing anywhere clears it. So an estimate reduced next month cannot
// bring the nudge back, and this file must never add "...and the bar is not
// full yet" to the condition below - that would be exactly the rule the
// timestamp exists to avoid, reimplemented in a component where it would
// disagree with the database the first time somebody reduced a number.
//
// WHAT THE TWO FIGURES ARE. The budget is the POOLED hours across the
// project's budget groups - set on project setup, not here - and the
// assigned figure is the total of every task estimate on the project, which
// is what `ProjectDetailDTO.rollup.budgetMinutes` holds. So the bar reads
// "of the hours you have budgeted, this much is already committed to
// tasks", which is the question somebody finishing the planning is
// answering.
//
// THE ARITHMETIC IS budgetProgress, the same helper every other bar in the
// module uses, including the two cases that would otherwise be got wrong
// here: nothing budgeted yet gives a null percentage rather than a full bar,
// and more assigned than budgeted gives a full bar beside a figure over 100.
//
// STAMPING IS AUTOMATIC ONCE THE BUDGET IS ALLOCATED, with a button beside
// it for the admin who has deliberately budgeted less than they planned. The
// service is idempotent by construction - two tabs finishing setup together
// cannot move the timestamp - so neither path can double-write, and neither
// can undo the other.
// -------------------------------------------------------------------
type Props = {
  projectId: string;
  /** Null until planning was finished once. Non-null hides this entirely. */
  budgetAssignedAt: Date | null;
  groups: BudgetGroupReportDTO[];
  /** Every task estimate on the project, in minutes. */
  assignedMinutes: number;
};

export function SetupBudgetNudge({ projectId, budgetAssignedAt, groups, assignedMinutes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Fired at most once per mount. Without it the effect would re-run on
  // every render caused by the refresh it asks for.
  const hasStamped = useRef(false);

  // The pool the project has been given, as the sum of its groups. A sum,
  // not a percentage: the percentage is budgetProgress's job.
  const budgetMinutes = groups.reduce((total, group) => total + group.rollup.budgetMinutes, 0);
  const progress = budgetProgress(budgetMinutes, assignedMinutes);

  // Null exactly when nothing has been budgeted, so this is "there is a
  // budget, and all of it is now committed".
  const isFullyAssigned = progress.percentUsed !== null && progress.percentUsed >= 100;

  const isDone = budgetAssignedAt !== null;

  const stamp = (announce: boolean) =>
    startTransition(async () => {
      try {
        const response = await markProjectBudgetAssignedAction({ projectId });

        if (!response.success) {
          // Only said out loud when somebody pressed something. The
          // automatic path failing silently leaves the nudge on screen,
          // which is the harmless outcome; a toast nobody asked for during
          // a network blip is not.
          if (announce) toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        if (announce) toast.success("Planning marked as finished.");

        router.refresh();
      } catch (error) {
        if (announce) handleFrontendErrorWithToast(error);
      }
    });

  useEffect(() => {
    if (isDone || !isFullyAssigned || hasStamped.current) return;

    hasStamped.current = true;
    stamp(false);
    // `stamp` is recreated every render and is not a dependency worth
    // tracking: the ref above is what makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone, isFullyAssigned]);

  // The server's answer, and the only condition. See the header.
  if (isDone) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign the budget</CardTitle>
        <CardDescription>
          How much of this project&apos;s budgeted hours is already committed to the tasks on this board. This
          panel is a nudge while the project is being planned: it goes once the budget has been assigned, and
          does not come back if an estimate is reduced later.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {budgetMinutes === 0 ? (
          // The zero-budget case has its own answer rather than a red bar:
          // nobody has budgeted anything, which is a thing to do next, not
          // an overrun to report.
          <p className="text-sm text-muted-foreground">
            No hours have been budgeted yet. Add a budget group in project setup and give it a pool of hours,
            and this shows how much of it the tasks on this board have already taken.
            {assignedMinutes > 0 &&
              ` Tasks currently carry ${formatMinutesAsClock(assignedMinutes)} of estimates between them.`}
          </p>
        ) : (
          <>
            <SetupBudgetBar rollup={progress} label="Budget assigned to tasks" usedWord="assigned" />

            {progress.isOverBudget && (
              <p className="text-sm text-destructive">
                More has been estimated on tasks than the budget groups hold between them. That is worth a look
                before the work starts, but nothing here stops it.
              </p>
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => stamp(true)} disabled={isPending} loading={isPending}>
            {isPending ? "Saving…" : "Finished planning"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
