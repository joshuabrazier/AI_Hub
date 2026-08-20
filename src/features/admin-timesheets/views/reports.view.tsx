import Link from "next/link";
import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

import { getTimesheetReportsPageService } from "../admin-timesheets-report.service";

// -------------------------------------------------------------------
// Reports: the saved write-ups.
//
// Deliberately NOT inside TimesheetShell. Every other timesheet screen is a
// view of one period and carries the period control to prove it; this is a
// filing cabinet, and a period selector at the top of it would suggest the list
// changes with the period. It does not - a report belongs to the period it was
// written about, which is on the row.
//
// Creating one therefore happens on the screens that DO have a period: the
// button lives on the Overview, next to the figures the report would quote.
// -------------------------------------------------------------------
export default async function ReportsView() {
  const { available, reports } = await getTimesheetReportsPageService();

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-heading text-3xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Saved write-ups of a period. Each one quotes the figures as they stood when it was written,
          and keeps them.
        </p>
      </div>

      {!available && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-3">
          <p className="text-sm font-medium text-foreground">Reports are not available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This environment has no AI model configured, so no new reports can be written. Any reports
            already saved are still readable.
          </p>
        </div>
      )}

      {reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No reports yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Open the{" "}
              <Link href={ROUTES.ADMIN_TIMESHEETS} className="underline underline-offset-4">
                Overview
              </Link>
              , choose the period you want written up, and press Create report.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            // Shown because a report of one project reads identically to a
            // report of the whole business once it is saved.
            const scope = [
              report.category !== "all" ? report.category : null,
              report.project !== "all" ? report.project : null,
              report.person !== "all" ? "one person" : null,
            ].filter(Boolean);

            return (
              <Card key={report.id} className="transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        <Link
                          href={`${ROUTES.ADMIN_TIMESHEETS_REPORTS}/${report.id}`}
                          className="hover:underline underline-offset-4"
                        >
                          {report.title}
                        </Link>
                      </CardTitle>

                      <CardDescription>
                        {report.periodLabel}
                        {report.authorName ? ` - written by ${report.authorName}` : ""} on{" "}
                        {formatDateTime(report.createdAt)}
                      </CardDescription>
                    </div>

                    {scope.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {scope.map((label) => (
                          <Badge key={label} variant="secondary">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
