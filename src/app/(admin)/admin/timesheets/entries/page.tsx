import TimesheetView from "@/features/admin-timesheets/views/timesheet.view";

export default async function AdminTimesheetEntries({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; start?: string; category?: string; project?: string; person?: string }>;
}) {
  const params = await searchParams;
  return <TimesheetView {...params} />;
}
