import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AiChatMarkdown } from "@/features/ai-chat/components/ai-chat-markdown";
import { formatDateTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

import { getTimesheetReportService } from "../admin-timesheets-report.service";
import { ReportDeleteButton } from "../report-delete-button";

// -------------------------------------------------------------------
// One saved report.
//
// The prose goes through AiChatMarkdown, which parses to an AST and emits
// React elements rather than an HTML string - the same reasoning as the
// summary panel and the chat. The model is repeating back job and project
// names that staff typed into Jira, so its output is untrusted twice over.
//
// THE FIGURES PANEL IS THE POINT of a saved report as opposed to a summary.
// The numbers shown are the ones stored WITH the report, not today's: that is
// what makes a three-month-old report answerable rather than merely readable,
// because the read model it was written from has re-synced many times since.
// -------------------------------------------------------------------
export default async function ReportView({ reportId }: { reportId: string }) {
  const report = await getTimesheetReportService(reportId);

  const business = report.facts?.business;
  const scope = [
    report.category !== "all" ? `category ${report.category}` : null,
    report.project !== "all" ? `project ${report.project}` : null,
    report.person !== "all" ? "one person" : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <Link
        href={ROUTES.ADMIN_TIMESHEETS_REPORTS}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        Back to reports
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-heading text-3xl font-bold text-foreground">{report.title}</h1>
          <p className="text-sm text-muted-foreground">
            {report.periodLabel}
            {report.authorName ? ` - written by ${report.authorName}` : ""} on{" "}
            {formatDateTime(report.createdAt)}
          </p>
        </div>

        <ReportDeleteButton id={report.id} title={report.title} />
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

      <Card>
        <CardContent className="pt-6">
          <AiChatMarkdown content={report.body} />
        </CardContent>
      </Card>

      {business && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The figures this was written from</CardTitle>
            <CardDescription>
              Saved with the report, so they are what was true when it was written rather than what is
              true now.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <Figure label="Logged" value={hours(business.loggedHours)} />
              <Figure label="Capacity" value={hours(business.capacityHours)} />
              <Figure label="Utilisation" value={percent(business.utilisationPercent)} />
              <Figure label="Billable" value={hours(business.billableHours)} />
              <Figure label="Billable share" value={percent(business.billableSharePercent)} />
              <Figure label="People" value={count(report.facts?.peopleCount)} />
              <Figure label="Entries" value={count(business.worklogCount)} />
              <Figure label="Jobs" value={count(report.facts?.jobsCount)} />
              <Figure label="Findings" value={count(report.facts?.findingsCount)} />
              <Figure label="Blocking" value={count(report.facts?.blockingCount)} />
            </dl>

            <p className="mt-6 text-xs text-muted-foreground">
              Written by {report.modelId}
              {report.totalInputTokens !== null && report.outputTokens !== null
                ? ` - ${report.totalInputTokens.toLocaleString()} input and ${report.outputTokens.toLocaleString()} output tokens`
                : ""}
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// Null is "not known", never "nought". A dash is the honest rendering: a
// stored report may predate a figure the report shape gained later, and
// printing 0 for it would be inventing evidence.
// -------------------------------------------------------------------
function hours(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(2)}h`;
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${value}%`;
}

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toLocaleString();
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-heading text-lg font-semibold text-foreground">{value}</dd>
    </div>
  );
}
