import StaffView from "@/features/admin-timesheets/views/staff.view";

export default async function AdminTimesheetStaff({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; start?: string; category?: string; project?: string; person?: string }>;
}) {
  const params = await searchParams;
  return <StaffView {...params} />;
}
