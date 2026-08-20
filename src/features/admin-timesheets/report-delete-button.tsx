"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { deleteTimesheetReportAction } from "./admin-timesheets-report.actions";

// -------------------------------------------------------------------
// Delete a report, behind a confirmation.
//
// Confirmed because it CANNOT be undone in any useful sense: rewriting would
// call the model again and quote today's figures, not the ones this report was
// written from. The dialog says that, rather than asking "are you sure" and
// leaving the reader to work out what they are sure about.
// -------------------------------------------------------------------
export function ReportDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      try {
        const response = await deleteTimesheetReportAction({ id });

        if (!response.success) {
          toast.error(response.formError ?? "Could not delete the report");
          return;
        }

        setOpen(false);
        toast.success("Report deleted");
        router.push(ROUTES.ADMIN_TIMESHEETS_REPORTS);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Trash2 className="size-4 shrink-0" aria-hidden="true" />
          Delete
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this report?</DialogTitle>
          <DialogDescription>
            &ldquo;{title}&rdquo; will be removed, along with the figures saved with it. Writing a new
            report of the same period will quote today&rsquo;s figures, not these ones, so this is not
            something that can be put back.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={remove} disabled={isPending} loading={isPending}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
