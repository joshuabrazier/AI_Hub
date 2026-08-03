"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableSort } from "@/components/data-table";
import { formatIsoDate } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { deleteClosureDayAction } from "../admin-closure-days.actions";
import { ClosureDayDTO } from "../admin-closure-days.types";
import { getClosureDaysColumns } from "./closure-days-columns";
import { ClosureDaysFormDialog } from "./closure-days-form-dialog";

// Dates are 'YYYY-MM-DD' strings, so a plain string compare orders them.
const SORTS: DataTableSort<ClosureDayDTO>[] = [
  { id: "date-asc", label: "Date (soonest)", compare: (a, b) => a.dayDate.localeCompare(b.dayDate) },
  { id: "date-desc", label: "Date (latest)", compare: (a, b) => b.dayDate.localeCompare(a.dayDate) },
];

// Hoisted so the reference is stable across renders: passed inline it would be
// a new array every render, churning the table's filtered-data memo and
// bouncing it back to page 1 whenever a dialog opens.
const CLOSURE_DAY_SEARCH_KEYS: (keyof ClosureDayDTO & string)[] = ["reason", "dayDate"];

export function ClosureDaysTable({ days }: { days: ClosureDayDTO[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ClosureDayDTO | null>(null);
  const [removing, startRemoving] = useTransition();

  const columns = getClosureDaysColumns({ onRemove: setRemoveTarget });

  const confirmRemove = () => {
    if (!removeTarget || removing) return;

    startRemoving(async () => {
      try {
        const response = await deleteClosureDayAction({ id: removeTarget.id });
        if (!response.success) {
          toast.error(response.formError ?? "Something went wrong. Please try again.");
          return;
        }
        toast.success("Closure day removed.");
        setRemoveTarget(null);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={days}
        searchPlaceholder="Search closure days..."
        searchKeys={CLOSURE_DAY_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add day</Button>}
        sortOptions={SORTS}
        emptyMessage="No closure days yet."
      />

      <ClosureDaysFormDialog open={addOpen} onOpenChange={setAddOpen} />

      {/* Confirm before removing a day - its sessions return to the schedule. */}
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
        title="Remove this closure day?"
        description={
          removeTarget
            ? `Sessions on ${formatIsoDate(removeTarget.dayDate, "EEEE d MMMM yyyy")} will show as running again on every schedule.`
            : undefined
        }
        confirmLabel="Remove day"
        pendingLabel="Removing..."
        isPending={removing}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
