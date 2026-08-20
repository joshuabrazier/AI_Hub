"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { createTimesheetReportAction } from "./admin-timesheets-report.actions";
import { REPORT_TITLE_MAX_LENGTH } from "./admin-timesheets-report.types";
import type { TimesheetFiltersDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Create a report.
//
// A dialog rather than a bare button, because a report is a NAMED artefact and
// the name is the only thing a person supplies. Prefilled with the period so
// the common case is one keystroke, and editable because "August 2026" is not
// what everybody would call it.
//
// It reports the period and filters it is about to write about, in words. A
// report of one project looks identical to a report of the business once it is
// saved, so the moment to be clear about which is before it is written.
// -------------------------------------------------------------------
export function ReportCreateDialog({
  filters,
  periodLabel,
  disabled,
}: {
  filters: TimesheetFiltersDTO;
  periodLabel: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  // Reset to the period's own name each time it opens, so reopening after a
  // period change does not offer the previous period's title.
  const onOpenChange = (next: boolean) => {
    if (next) setTitle(`${periodLabel} review`);
    setOpen(next);
  };

  const filterSummary = [
    filters.category !== "all" ? `category ${filters.category}` : null,
    filters.project !== "all" ? `project ${filters.project}` : null,
    filters.person !== "all" ? "one person" : null,
  ].filter(Boolean);

  const create = () => {
    startTransition(async () => {
      try {
        const response = await createTimesheetReportAction({
          title,
          granularity: filters.granularity,
          start: filters.start,
          category: filters.category,
          project: filters.project,
          person: filters.person,
        });

        if (!response.success) {
          toast.error(response.formError ?? "Could not write the report");
          return;
        }

        if (response.data.unavailable || !response.data.id) {
          toast.error("Reports are not available: this environment has no AI model configured.");
          return;
        }

        setOpen(false);

        // Straight to the report just written. A list with a new row on it
        // would leave the reader to find their own document.
        router.push(`${ROUTES.ADMIN_TIMESHEETS_REPORTS}/${response.data.id}`);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          Create report
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a report</DialogTitle>
          <DialogDescription>
            A written-up account of {periodLabel}
            {filterSummary.length > 0 ? `, filtered to ${filterSummary.join(" and ")}` : ""}. It is saved
            and kept, and the figures it quotes are stored with it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="report-title">Name</Label>
          <Input
            id="report-title"
            value={title}
            maxLength={REPORT_TITLE_MAX_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
            disabled={isPending}
            placeholder="e.g. August 2026 review"
          />
          <p className="text-xs text-muted-foreground">
            Writing one takes about half a minute.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={create} disabled={isPending || title.trim().length === 0} loading={isPending}>
            {isPending ? "Writing" : "Write report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
