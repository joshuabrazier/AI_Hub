import type { TimesheetSearchParams } from "@/features/admin-timesheets/admin-timesheets.service";
import StaffView from "@/features/admin-timesheets/views/staff.view";

export default async function AdminTimesheetStaff({
  searchParams,
}: {
  searchParams: Promise<TimesheetSearchParams>;
}) {
  const params = await searchParams;
  return <StaffView {...params} />;
}
