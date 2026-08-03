"use client";

import { TriangleAlert } from "lucide-react";

// -------------------------------------------------------------------
// The stored value could not be read, so the site is rendering the shipped
// default instead. Say so plainly: without this the admin sees their own saved
// copy nowhere on the site and has no way to find out why.
//
// Shared by the home page blocks and the contact details, because both fall
// back the same way and both need the same escape route - the form under this
// notice is seeded with the default, so its Save button stays enabled even
// though nothing has been typed. Telling someone to save a form that cannot be
// submitted would be worse than saying nothing at all.
// -------------------------------------------------------------------
export function IgnoredValueNotice({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-medium text-destructive">{title}</p>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
