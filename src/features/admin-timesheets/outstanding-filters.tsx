"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { OutstandingOption } from "./admin-timesheets-outstanding.service";

// -------------------------------------------------------------------
// Client, then project.
//
// Its own control rather than the shared timesheet filter bar, for one
// reason: that bar writes granularity and start into every URL it builds,
// because every other timesheet screen is about a period. This one is not,
// and a month in its URL would be a parameter nothing reads and everybody
// would eventually assume was doing something.
//
// The filters still live in the URL, which is the rule the shared bar exists
// to keep. "The number I am looking at" is exactly what gets pasted into an
// email when somebody asks how much is left on a job, and a page that always
// reopens unfiltered makes that impossible.
//
// CHOOSING A CLIENT CLEARS THE PROJECT. A project belongs to one client, so
// carrying it across would either show one client's heading above another
// client's work or silently select nothing. The service drops a mismatched
// project too - this just avoids provoking it.
// -------------------------------------------------------------------

const ALL = "all";

function hoursLabel(option: OutstandingOption): string {
  if (!option.hasEstimates) {
    // Not "0 h". Nothing under it is estimated, so the honest label is that
    // the figure is unknown - and saying so here means the dead end is
    // visible before the click rather than after it.
    return `${option.openCount} open, not sized`;
  }

  return `${(option.remainingSeconds / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 })} h left`;
}

export function OutstandingFilters({
  clientOptions,
  projectOptions,
  clientKey,
  projectKey,
}: {
  clientOptions: OutstandingOption[];
  projectOptions: OutstandingOption[];
  clientKey: string | null;
  projectKey: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Navigation runs inside a transition so the controls stay live and the old
  // figures stay on screen while the server re-renders, rather than the page
  // blanking to a spinner.
  const [isPending, startTransition] = useTransition();

  const go = (next: { client?: string | null; project?: string | null }) => {
    const params = new URLSearchParams();

    const client = next.client === undefined ? clientKey : next.client;
    // Changing the client discards the project. See the note above.
    const project = next.client !== undefined ? null : next.project === undefined ? projectKey : next.project;

    if (client != null && client !== ALL) params.set("client", client);
    if (project != null && project !== ALL) params.set("project", project);

    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted/20 p-2"
      data-pending={isPending ? "" : undefined}
    >
      <Select value={clientKey ?? ALL} onValueChange={(value) => go({ client: value === ALL ? null : value })}>
        <SelectTrigger className="w-[16rem]" aria-label="Client">
          <SelectValue placeholder="All clients" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All clients</SelectItem>
          {clientOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
              <span className="ml-2 text-xs text-muted-foreground">{hoursLabel(option)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={projectKey ?? ALL}
        onValueChange={(value) => go({ project: value === ALL ? null : value })}
        // A project cannot be chosen before its client. Disabled rather than
        // hidden, so the second step is visibly there waiting rather than
        // appearing out of nowhere once a client is picked.
        disabled={clientKey == null || projectOptions.length === 0}
      >
        <SelectTrigger className="w-[22rem]" aria-label="Project">
          <SelectValue placeholder={clientKey == null ? "Choose a client first" : "All projects"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All projects</SelectItem>
          {projectOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
              <span className="ml-2 text-xs text-muted-foreground">{hoursLabel(option)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
