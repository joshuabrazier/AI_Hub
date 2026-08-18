import StaffView from "@/features/admin-timesheets/views/staff.view";

export default async function AdminTimesheetStaff({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string; project?: string; person?: string; week?: string }>;
}) {
  const params = await searchParams;
  return <StaffView {...params} />;
}
