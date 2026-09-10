"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";

import { archiveProjectAction } from "../delivery-setup.actions";

// -------------------------------------------------------------------
// SetupProjectArchiveButton
//
// This module's DELETE, and the only one a project gets.
//
// There is no hard delete and there will not be: time entries reference
// tasks ON DELETE RESTRICT, so a project with any hours logged cannot be
// removed - and one without them still should not be, because "we did not
// end up doing this" is part of the record. Archiving takes it out of the
// nav, the pickers and every default list, and leaves all of it readable.
//
// SEPARATE FROM THE EDIT DIALOG ON PURPOSE. The status picker in that form
// is where you would expect to find this, and it is deliberately not there:
// a project leaving every list is not the same kind of act as fixing its
// title, and it should not be one option in a dropdown away from somebody
// who opened the form for a typo. Hence a confirmation naming the project,
// and the service's own audit line saying it was archived rather than that
// a status changed.
//
// IT ONLY RENDERS WHEN THERE IS SOMETHING TO DO. An already-archived
// project shows nothing here - restoring one is an edit, and the edit dialog
// owns it. A button that said "Archive" for a project that is archived would
// be a no-op the service silently swallows.
// -------------------------------------------------------------------
export function SetupProjectArchiveButton({
  projectId,
  projectTitle,
}: {
  projectId: string;
  /** Named in the confirmation, because this is the act worth being sure about. */
  projectTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      try {
        const response = await archiveProjectAction({ projectId });

        if (!response.success) {
          // The service's own sentence - it refuses in words, and reducing
          // that to "something went wrong" loses the reason.
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success("Project archived");
        setOpen(false);
        router.refresh();
      } catch {
        toast.error(MESSAGES.SOMETHING_WENT_WRONG);
      }
    });

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Archive size={14} aria-hidden="true" />
        Archive
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Archive this project?"
        // The title is typed by somebody and reaches this as a prop, which
        // React renders as a text node like everything else in this feature.
        description={`"${projectTitle}" will be taken out of the nav, the project pickers and every default list, and no more time can be logged against it. Nothing is deleted - the board, its phases and every hour logged stay readable, and an administrator can make it active again.`}
        confirmLabel="Archive project"
        pendingLabel="Archiving..."
        isPending={isPending}
        onConfirm={confirm}
      />
    </>
  );
}
