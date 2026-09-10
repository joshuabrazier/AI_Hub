import { getAdminTimesheetsCsvService } from "@/features/admin-timesheets/admin-timesheets.service";

// Reads the database and the session, so it runs on the Node runtime and is
// never statically cached - a cached export would hand one period's hours to a
// request asking for another.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// GET /admin/timesheets/export?granularity=&start=&category=&client=&project=&person=&billable=
//
// The period's worklog rows as CSV.
//
// The service re-runs its own admin guard and rebuilds the report from the
// database rather than accepting anything from the caller. A route that
// serialised a report handed to it would be a way to read a period the
// requester was never shown.
//
// Errors are deliberately not caught here: handleError inside the service
// already logs them, and Next's own error handling answers 500 without
// putting a stack trace in a file somebody opens in Excel.
// -------------------------------------------------------------------
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // EVERY FILTER THE LINK CARRIES, not four of the seven.
  //
  // The Export CSV button builds its href with filterQuery(filters), which
  // emits client, person and billable as well - and this handler used to read
  // only granularity, start, category and project, so those three were
  // silently dropped. Pressing Export on one person's page, or on a screen
  // narrowed to a single client or to billable time, downloaded the whole
  // company's entries for the period.
  //
  // Worse than a wrong file: the filename's scope suffix is built by the
  // service from the filters it was GIVEN, so the discarded ones vanished
  // from the name too and a company-wide export arrived looking like a
  // legitimately unfiltered one. This is the file somebody invoices from.
  const { filename, csv } = await getAdminTimesheetsCsvService({
    granularity: params.get("granularity") ?? undefined,
    start: params.get("start") ?? undefined,
    category: params.get("category") ?? undefined,
    client: params.get("client") ?? undefined,
    project: params.get("project") ?? undefined,
    person: params.get("person") ?? undefined,
    billable: params.get("billable") ?? undefined,
  });

  // A UTF-8 BOM, so Excel reads accented names correctly rather than as
  // mojibake. Without it "Renee" is fine but "Renée" opens as "RenÃ©e", and
  // the charset in the Content-Type does not help: Excel ignores it.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
