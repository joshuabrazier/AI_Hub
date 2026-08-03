"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { deleteDocumentAction } from "../admin-documents.actions";
import { DocumentResponseDTO } from "../admin-documents.types";
import { DocumentFormDialog } from "./document-form-dialog";
import { getDocumentsColumns } from "./documents-columns";

const DOCUMENT_SORTS: DataTableSort<DocumentResponseDTO>[] = [
  { id: "order", label: "Display order", compare: (a, b) => a.orderBy - b.orderBy || a.title.localeCompare(b.title) },
  { id: "title", label: "Title (A-Z)", compare: (a, b) => a.title.localeCompare(b.title) },
  { id: "signed-desc", label: "Most signed", compare: (a, b) => b.signedCount - a.signedCount },
];

const DOCUMENT_FACETS: DataTableFacet<DocumentResponseDTO>[] = [
  {
    id: "required",
    label: "Requirement",
    options: [
      { value: "required", label: "Required" },
      { value: "optional", label: "Optional" },
    ],
    getValue: (doc) => (doc.isRequired ? "required" : "optional"),
  },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const DOCUMENT_SEARCH_KEYS: (keyof DocumentResponseDTO & string)[] = ["title", "key"];

const DOCUMENT_ACTIVE_FILTER: DataTableToggle<DocumentResponseDTO> = { predicate: (doc) => doc.isActive };

// -------------------------------------------------------------------
// DocumentsTable
//
// The list of signable documents, and where they are added and edited. Only an
// admin sees this: the documents themselves are platform-wide configuration,
// and the service refuses anybody else regardless of what is rendered.
// -------------------------------------------------------------------
export function DocumentsTable({ documents }: { documents: DocumentResponseDTO[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentResponseDTO | null>(null);
  const [deleting, setDeleting] = useState<DocumentResponseDTO | null>(null);
  const [isPending, startTransition] = useTransition();

  const columns = getDocumentsColumns({
    onEdit: (doc) => setEditing(doc),
    onDelete: (doc) => setDeleting(doc),
  });

  const handleDelete = () => {
    if (!deleting || isPending) return;

    const doc = deleting;

    startTransition(async () => {
      const response = await deleteDocumentAction({ id: doc.id });

      if (!response.success) {
        toast.error(response.formError ?? "Could not delete that document.");
        return;
      }

      toast.success("Document deleted");
      setDeleting(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={documents}
        searchPlaceholder="Search documents..."
        searchKeys={DOCUMENT_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add document</Button>}
        activeFilter={DOCUMENT_ACTIVE_FILTER}
        sortOptions={DOCUMENT_SORTS}
        facetFilters={DOCUMENT_FACETS}
        emptyMessage="No documents yet."
      />

      {/* Create */}
      <DocumentFormDialog doc={null} open={addOpen} onOpenChange={setAddOpen} />

      {/* Edit */}
      <DocumentFormDialog
        key={editing?.id ?? "new"}
        doc={editing}
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />

      {/* Delete. Worth a confirmation of its own: retiring is almost always
          what is wanted, and the difference is not obvious from the button. */}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.title}?</DialogTitle>
            <DialogDescription>
              The signatures already recorded stay exactly as they are - each one carries its own copy of what
              was signed. The document simply stops being offered and stops appearing in the overview.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            If you only want to stop asking for it, edit the document and turn off &ldquo;Active&rdquo;
            instead. That keeps it in the overview alongside its history.
          </p>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              loading={isPending}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : "Delete document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
