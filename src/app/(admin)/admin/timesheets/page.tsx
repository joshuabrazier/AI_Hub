import OverviewView from "@/features/admin-timesheets/views/overview.view";

export default async function AdminTimesheetsOverview({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; start?: string; category?: string; project?: string; person?: string }>;
}) {
  const params = await searchParams;
  return <OverviewView {...params} />;
}
