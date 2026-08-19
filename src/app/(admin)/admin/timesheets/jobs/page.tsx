import JobsView from "@/features/admin-timesheets/views/jobs.view";

export default async function AdminTimesheetJobs({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; start?: string; category?: string; project?: string; person?: string }>;
}) {
  const params = await searchParams;
  return <JobsView {...params} />;
}
