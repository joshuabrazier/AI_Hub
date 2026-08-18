import JobsView from "@/features/admin-timesheets/views/jobs.view";

export default async function AdminTimesheetJobs({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string; project?: string; person?: string; week?: string }>;
}) {
  const params = await searchParams;
  return <JobsView {...params} />;
}
