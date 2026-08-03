"use client";

import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type AppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Widen a dialog that needs it, e.g. "sm:max-w-2xl" for a two-column form. */
  contentClassName?: string;
  children: ReactNode;
};

// -------------------------------------------------------------------
// AppDialog
//
// The centred heading every admin dialog opens with. Kept in one place so a
// title never drifts in size or weight between screens, and so the accessible
// description is a real DialogDescription rather than a loose paragraph Radix
// cannot wire up to the dialog.
//
// Children are rendered as direct children of DialogContent, which lays its
// content out as a grid - so each one keeps the standard gap below the header.
// -------------------------------------------------------------------
export function AppDialog({ open, onOpenChange, title, description, contentClassName, children }: AppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("sm:max-w-lg", contentClassName)}>
        <DialogHeader className="text-center">
          <DialogTitle className="text-3xl font-extrabold">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {children}
      </DialogContent>
    </Dialog>
  );
}
