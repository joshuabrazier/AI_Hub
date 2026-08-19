
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIsoDate } from "@/lib/format";
import { PersonDayTotal } from "@/lib/timesheet/timesheet.types";
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
