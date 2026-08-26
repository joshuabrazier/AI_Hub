import type { TimesheetSearchParams } from "@/features/admin-timesheets/admin-timesheets.service";
import OverviewView from "@/features/admin-timesheets/views/overview.view";

export default async function AdminTimesheetsOverview({
  searchParams,
}: {
  searchParams: Promise<TimesheetSearchParams>;
}) {
  const params = await searchParams;
  return <OverviewView {...params} />;
}
