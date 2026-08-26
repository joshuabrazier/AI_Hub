import type { TimesheetSearchParams } from "@/features/admin-timesheets/admin-timesheets.service";
import TimesheetView from "@/features/admin-timesheets/views/timesheet.view";

export default async function AdminTimesheetEntries({
  searchParams,
}: {
  searchParams: Promise<TimesheetSearchParams>;
}) {
  const params = await searchParams;
  return <TimesheetView {...params} />;
}
