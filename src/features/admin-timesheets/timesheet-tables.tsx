import { FileWarning } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIsoDate } from "@/lib/format";
import { PersonDayTotal, WorklogFactRow } from "@/lib/timesheet/timesheet.types";
import { cn } from "@/lib/utils";

import { Reveal } from "./timesheet-motion";
import { formatHours } from "./timesheet-panels";

// -------------------------------------------------------------------
// The tables that make up each view.
//
// Every figure comes from the aggregation engine. Nothing here adds anything
// up, which is what keeps the four views from ever disagreeing with each other
// or with the CSV.
// -------------------------------------------------------------------

// A start time as a wall clock, from seconds past app-zone midnight. The
// conversion happened at sync time; this only formats it.
function formatStartSecond(startSecond: number | null): string {
  if (startSecond === null) return "-";
  const hours = Math.floor(startSecond / 3600);
  const minutes = Math.floor((startSecond % 3600) / 60);
  const period = hours < 12 ? "am" : "pm";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")}${period}`;
}

// -------------------------------------------------------------------
// The timesheet: one row per entry, which is the grain everything else is
// summed from. This is the view somebody checks a figure against.
// -------------------------------------------------------------------
export function EntriesTable({ facts }: { facts: WorklogFactRow[] }) {
  const totalHours = facts.reduce((total, fact) => total + fact.timeSpentSeconds, 0) / 3600;

  return (
    <Reveal>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Date</TableHead>
                <TableHead className="w-[80px]">Start</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Work</TableHead>
                <TableHead className="w-[90px] text-right">Hours</TableHead>
                <TableHead className="w-[120px]">Billable</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {facts.map((fact) => (
                <TableRow key={fact.worklogId} className="transition-colors hover:bg-muted/50">
                  <TableCell className="whitespace-nowrap tabular-nums">{formatIsoDate(fact.workDate)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatStartSecond(fact.startSecond)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fact.personName ?? fact.personId}</TableCell>

                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{fact.parentSummary ?? fact.parentKey ?? "No job"}</span>
                      <span className="font-mono text-xs text-muted-foreground">{fact.issueKey}</span>
                    </div>
                  </TableCell>

                  <TableCell className="max-w-[340px]">
                    {fact.hasNarrative ? (
                      <span className="text-sm">{fact.issueSummary}</span>
                    ) : (
                      // The gap that cannot be defended if a client queries
                      // the line. Stated on the row, not buried in a warnings
                      // panel somebody has to go and read.
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <FileWarning className="size-3.5 shrink-0" aria-hidden />
                        No description
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-right font-medium tabular-nums">
                    {(fact.timeSpentSeconds / 3600).toFixed(2)}
                  </TableCell>

                  <TableCell>
                    {fact.billable === null ? (
                      <Badge variant="destructive">Unset</Badge>
                    ) : (
                      <span className="flex flex-col">
                        <span className="text-sm">{fact.billable}</span>
                        {fact.billableSource === "parent" && (
                          <span className="text-xs text-muted-foreground">inherited</span>
                        )}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>

            <TableFooter>
              <TableRow>
                <TableCell colSpan={5}>
                  {facts.length} {facts.length === 1 ? "entry" : "entries"}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{totalHours.toFixed(2)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// One person, day by day.
//
// Only days with an entry appear. An absent day is not a zero - it may be
// leave, a weekend or a public holiday, and a 0% bar under someone's name
// every Sunday would be a lie about their week.
// -------------------------------------------------------------------
export function PersonDaysTable({ days, workingHoursPerDay }: { days: PersonDayTotal[]; workingHoursPerDay: number }) {
  if (days.length === 0) return null;

  return (
    <Reveal index={1}>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="text-right">Against {workingHoursPerDay}h</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((day) => {
                const over = day.utilisation !== null && day.utilisation > 1;

                return (
                  <TableRow key={`${day.personId}-${day.workDate}`} className="transition-colors hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap">{formatIsoDate(day.workDate, "EEE d MMM")}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatHours(day.hours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatHours(day.split.billableHours)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {day.worklogCount}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", over && "font-medium")}>
                      {day.utilisation === null ? "n/a" : `${Math.round(day.utilisation * 100)}%`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Reveal>
  );
}
