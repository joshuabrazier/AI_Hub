"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DataTable, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CreateEditDialogs } from "@/components/row-dialogs";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { deactivateClientAction, updateClientAction } from "../delivery-setup.actions";
import type { ClientSummaryDTO } from "../delivery.types";
import { SetupClientFormDialog } from "./setup-client-form-dialog";
import { getSetupClientsColumns } from "./setup-clients-columns";

// -------------------------------------------------------------------
// The client list.
//
// FOUR ACTS AND NO FIFTH: create, rename, retire, restore. There is no
// delete anywhere on this screen, and the paragraph under the table says so
// - a client with projects cannot be removed without taking their time
// entries, which are billing history, so `projects.client_id` is ON DELETE
// RESTRICT and retiring is what "gone" means here.
//
// RETIRING AND RESTORING ARE DIFFERENT MUTATIONS, deliberately. Retiring is
// the narrow deactivateClientAction, which touches nothing but the flag;
// restoring has to go through the wider updateClientAction because there is
// no narrow one, so it carries the name it was given back unchanged. Doing
// the retire through the wide form as well would mean a stale row renames a
// client as a side effect of a button that says Retire.
// -------------------------------------------------------------------

const CLIENT_SORTS: DataTableSort<ClientSummaryDTO>[] = [
  { id: "name", label: "Name (A-Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "name-desc", label: "Name (Z-A)", compare: (a, b) => b.name.localeCompare(a.name) },
  { id: "projects-desc", label: "Most projects", compare: (a, b) => b.projectCount - a.projectCount },
];

// Hoisted so the reference is stable across renders - passed inline these
// churn the table's filtered-data memo and bounce it back to page 1 every
// time a dialog opens.
const CLIENT_SEARCH_KEYS: (keyof ClientSummaryDTO & string)[] = ["name"];

const CLIENT_ACTIVE_FILTER: DataTableToggle<ClientSummaryDTO> = {
  label: "Active only",
  predicate: (client) => client.isActive,
};

export function SetupClientsTable({ clients }: { clients: ClientSummaryDTO[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<ClientSummaryDTO | null>(null);
  const [retiring, setRetiring] = useState<ClientSummaryDTO | null>(null);

  const restore = (client: ClientSummaryDTO) =>
    startTransition(async () => {
      try {
        const response = await updateClientAction({
          clientId: client.id,
          // The name and the notes travel back unchanged: this is the wide
          // mutation being used for a narrow act, because there is no
          // narrow restore. See the note in SetupClientFormDialog for why
          // null is the honest value for notes rather than a loss.
          name: client.name,
          notes: null,
          isActive: true,
        });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(`${client.name} is active again`);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  // Retiring and restoring are row buttons rather than a switch in the
  // rename dialog: both are one decision, and burying them in a form means
  // a stale field somewhere else in it rides along.
  const columns = getSetupClientsColumns({
    onRename: setRenaming,
    onRetire: setRetiring,
    onRestore: restore,
  });

  const confirmRetire = () =>
    startTransition(async () => {
      if (!retiring) return;

      try {
        const response = await deactivateClientAction({ clientId: retiring.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(`${retiring.name} retired`);
        setRetiring(null);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={clients}
        searchPlaceholder="Search clients..."
        searchKeys={CLIENT_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add client</Button>}
        activeFilter={CLIENT_ACTIVE_FILTER}
        sortOptions={CLIENT_SORTS}
        emptyMessage="No clients yet."
      />

      {/* Said here rather than discovered by pressing something. A delete
          button on a client with projects can only ever fail, and being told
          why afterwards is a worse version of being told first. */}
      <p className="max-w-3xl text-sm text-muted-foreground">
        A client is never deleted. Their projects hold their time entries, and that is billing history, so removing
        a client would have to take it with them. Retiring is the way out instead: a retired client keeps every
        project and every hour already logged, and simply stops being offered when a new project is started. The
        projects column is what that costs - a client with projects has history behind them.
      </p>

      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        selected={renaming}
        onClearSelected={() => setRenaming(null)}
        render={(client, open, onOpenChange) => (
          <SetupClientFormDialog client={client} open={open} onOpenChange={onOpenChange} />
        )}
      />

      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null);
        }}
        title={`Retire ${retiring?.name ?? "this client"}?`}
        description={
          retiring
            ? `${retiring.name} stops being offered when a new project is started. Their ${retiring.projectCount} project${
                retiring.projectCount === 1 ? "" : "s"
              } and every hour logged against them stay exactly as they are, and you can restore them from this screen at any time.`
            : undefined
        }
        confirmLabel="Retire"
        pendingLabel="Retiring..."
        isPending={isPending}
        onConfirm={confirmRetire}
      />
    </div>
  );
}
