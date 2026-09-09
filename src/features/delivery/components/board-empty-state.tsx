import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// BoardEmptyState
//
// The one shape for "there is nothing here", used by the three empty
// screens this feature has - a project with no phases, a phase with no
// tasks, and a person who is on no projects at all. They are three
// different sentences and each says what to do next, which is the whole
// reason they are separate: "nothing to show" three times would leave
// somebody staring at a board with no idea whose job it is to fill it.
//
// The ACTION is optional and is the caller's, because what to do next
// depends on whether the reader may do it. A member looking at a project
// with no phases gets a sentence naming who adds one; a lead gets a
// button.
// -------------------------------------------------------------------
export function BoardEmptyState({
  icon,
  title,
  detail,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
