import { getAdminTimesheetsCsvService } from "@/features/admin-timesheets/admin-timesheets.service";

// Reads the database and the session, so it runs on the Node runtime and is
// never statically cached - a cached export would hand one period's hours to a
// request asking for another.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// GET /admin/timesheets/export?month=YYYY-MM
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

  const { filename, csv } = await getAdminTimesheetsCsvService({
    granularity: params.get("granularity") ?? undefined,
    start: params.get("start") ?? undefined,
    category: params.get("category") ?? undefined,
    project: params.get("project") ?? undefined,
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
