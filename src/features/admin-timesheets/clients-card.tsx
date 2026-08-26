"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BudgetRow } from "@/lib/timesheet/timesheet.types";
import { cn } from "@/lib/utils";

import type { ClientOptionDTO } from "./admin-timesheets.types";
import { Reveal } from "./timesheet-motion";

// -------------------------------------------------------------------
// Clients, each opening onto its projects.
//
// TWO LEVELS BECAUSE THE BUSINESS HAS TWO. Jira calls them projects and
// issues; the business calls them clients and projects, and an invoice is
// written against the second one. A flat list of every project belonging to
// everybody could not answer "how are we doing for Trainer Suzie", which is
// the question somebody actually opens this screen with.
//
// EVERY project appears, including the ones with nothing booked. A project
// nobody has started, or one whose time is being recorded somewhere other than
// Jira, is the most interesting row here - and both vanish if the table only
// lists projects with hours. The same is true one level up: a client with no
// time this period still appears, because "no time against them" is a fact
// worth seeing rather than an empty row to hide.
//
// Expansion is local state, deliberately. It is a way of looking at the page
// rather than a different page, so it does not belong in the URL - unlike
// every filter, which does.
// -------------------------------------------------------------------
export function ClientsCard({
  clients,
  projects,
  index,
}: {
  clients: ClientOptionDTO[];
  projects: BudgetRow[];
  index: number;
}) {
  // The "All clients" entry is a filter control, not a client.
  const realClients = clients.filter((client) => client.value !== "all");

  // Projects whose client is missing from the client list, plus any with no
  // client at all, gather under one heading rather than being dropped. Time
  // that cannot be attributed is exactly what somebody needs to find.
  const known = new Set(realClients.map((client) => client.value));
  const orphans = projects.filter((project) => !project.clientKey || !known.has(project.clientKey));

  const [open, setOpen] = useState<string[]>([]);
  const toggle = (key: string) =>
    setOpen((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  if (realClients.length === 0 && orphans.length === 0) return null;

  const started = projects.filter((project) => project.worklogCount > 0).length;

  return (
    <Reveal index={index}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Clients</CardTitle>
          <CardDescription>
            {`${realClients.length} ${realClients.length === 1 ? "client" : "clients"}, ${projects.length} ${
              projects.length === 1 ? "project" : "projects"
            }, ${projects.length - started} with no time booked in this period. `}
            Open a client to see what is booked against it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-2">
          {realClients.map((client) => (
            <ClientRow
              key={client.value}
              name={client.label}
              clientKey={client.value}
              category={client.category}
              hours={client.hours}
              projects={projects.filter((project) => project.clientKey === client.value)}
              isOpen={open.includes(client.value)}
              onToggle={() => toggle(client.value)}
            />
          ))}

          {orphans.length > 0 && (
            <ClientRow
              name="No client"
              clientKey="__orphans"
              category={null}
              hours={orphans.reduce((total, project) => total + project.actualHours, 0)}
              projects={orphans}
              isOpen={open.includes("__orphans")}
              onToggle={() => toggle("__orphans")}
            />
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}

function ClientRow({
  name,
  clientKey,
  category,
  hours,
  projects,
  isOpen,
  onToggle,
}: {
  name: string;
  clientKey: string;
  category: string | null;
  hours: number;
  projects: BudgetRow[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = `client-${clientKey}`;
  const quiet = hours === 0;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          "hover:bg-muted/40",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
        />

        <span className={cn("min-w-0 flex-1 truncate font-medium", quiet ? "text-muted-foreground" : "text-foreground")}>
          {name}
        </span>

        {category && (
          <Badge variant="outline" className="shrink-0">
            {category}
          </Badge>
        )}

        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>

        <span
          className={cn(
            "w-24 shrink-0 text-right font-heading text-sm font-semibold tabular-nums",
            quiet ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {hours.toFixed(2)} h
        </span>
      </button>

      {isOpen && (
        <div id={panelId} className="border-t border-border">
          {projects.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              No projects recorded against this client.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((project) => (
                <ProjectRow key={project.projectKey} project={project} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project }: { project: BudgetRow }) {
  const untouched = project.worklogCount === 0;

  // Over budget is worth colour; having no estimate at all is worth saying,
  // but it is not a fault - plenty of work is not estimated up front.
  const over = project.varianceHours !== null && project.varianceHours > 0;

  return (
    <li className="flex items-center gap-3 px-3 py-2 pl-10">
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", untouched ? "text-muted-foreground" : "text-foreground")}>
          {project.projectSummary ?? project.projectKey}
        </span>
        <span className="block font-mono text-xs text-muted-foreground">
          {project.projectKey}
          {project.billable && ` - ${project.billable}`}
        </span>
      </span>

      <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {project.currentHours !== null ? `${project.currentHours.toFixed(2)}h budget` : "No estimate"}
      </span>

      <span
        className={cn(
          "w-24 shrink-0 text-right text-sm tabular-nums",
          over ? "font-semibold text-data-caution" : untouched ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {project.actualHours.toFixed(2)} h
      </span>
    </li>
  );
}
