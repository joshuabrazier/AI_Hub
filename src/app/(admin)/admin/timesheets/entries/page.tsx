import TimesheetView from "@/features/admin-timesheets/views/timesheet.view";

export default async function AdminTimesheetEntries({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string; project?: string; person?: string; week?: string }>;
}) {
  const params = await searchParams;
  return <TimesheetView {...params} />;
}
