"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { syncTimesheetsNowAction } from "./admin-timesheets.actions";

// -------------------------------------------------------------------
// Refresh from Jira.
//
// Pulls whatever has changed since the last successful sync, then re-renders
// every timesheet view against the new read model.
//
// It is incremental, not a full reload: the job asks Jira for worklogs changed
// since the stored watermark, so a press when nothing has changed costs two API
// calls and reports "already up to date" rather than silently doing nothing.
//
// The button is disabled while a run is in flight. That is a courtesy, not a
// safety measure - the sync is idempotent, so a double press would land on the
// same rows regardless.
// -------------------------------------------------------------------
export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSyncing, setIsSyncing] = useState(false);

  const busy = isPending || isSyncing;

  async function refresh() {
    setIsSyncing(true);

    try {
      const result = await syncTimesheetsNowAction();

      if (!result.success) {
        toast.error(result.formError ?? "The sync failed.");
        return;
      }

      // A dry run changed nothing, so it is reported as a warning rather than
      // as success - otherwise the toast reads like the data moved when it did
      // not.
      if (result.data.dryRun) toast.warning(result.data.message);
      else toast.success(result.data.message);

      // revalidatePath marked the server data stale; this re-fetches the view
      // being looked at so the numbers change under the user without a manual
      // reload.
      startTransition(() => router.refresh());
    } catch {
      toast.error("The sync could not be started.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Button variant="outline" className={className} onClick={refresh} disabled={busy} aria-busy={busy}>
      <RefreshCw className={cn(busy && "animate-spin")} aria-hidden />
      {busy ? "Refreshing" : "Refresh from Jira"}
    </Button>
  );
}
