import type { TimesheetSearchParams } from "@/features/admin-timesheets/admin-timesheets.service";
import RndView from "@/features/admin-timesheets/views/rnd.view";

export default async function AdminTimesheetRnd({
  searchParams,
}: {
  searchParams: Promise<TimesheetSearchParams>;
}) {
  const params = await searchParams;
  return <RndView {...params} />;
}
