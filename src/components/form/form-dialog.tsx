"use client";

import type { FormEvent, ReactNode } from "react";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";

type FormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Runs whenever the dialog is dismissed - by Cancel, the close button or the
   * overlay - before the parent is told. Reset the form here so the next open
   * does not inherit half-typed values.
   */
  onDismiss?: () => void;
  title: string;
  description?: ReactNode;
  /** Widen the dialog, e.g. "sm:max-w-2xl" for a two-column form. */
  contentClassName?: string;
  /** Read-only content between the heading and the form (e.g. who is being edited). */
  beforeForm?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  pendingLabel?: string;
  /** The dialog's own gate - validity, a dirty check, a confirmation, whatever it uses. */
  canSubmit: boolean;
  isPending: boolean;
  /** Replaces the Cancel/Submit row, for a dialog that needs its own step there. */
  footer?: ReactNode;
  children: ReactNode;
};

// -------------------------------------------------------------------
// FormDialog
//
// The shell every create/edit dialog shares: centred heading, a form with
// consistent spacing, and a Cancel/Submit row that disables itself while the
// action runs. The fields are the caller's; everything around them is here.
//
// Pair it with useFormDialogSubmit, which owns the submit half.
// -------------------------------------------------------------------
export function FormDialog({
  open,
  onOpenChange,
  onDismiss,
  title,
  description,
  contentClassName,
  beforeForm,
  onSubmit,
  submitLabel,
  pendingLabel = "Saving...",
  canSubmit,
  isPending,
  footer,
  children,
}: FormDialogProps) {
  // Cancel dismisses by the same path as the overlay, so the form is reset
  // either way rather than only when the overlay happens to be clicked.
  const dismiss = () => {
    onDismiss?.();
    onOpenChange(false);
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onDismiss?.();
        onOpenChange(isOpen);
      }}
      title={title}
      description={description}
      contentClassName={contentClassName}
    >
      {beforeForm}

      <form onSubmit={onSubmit} className="space-y-5">
        {children}

        {footer ?? (
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={dismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !canSubmit} loading={isPending}>
              {isPending ? pendingLabel : submitLabel}
            </Button>
          </div>
        )}
      </form>
    </AppDialog>
  );
}
