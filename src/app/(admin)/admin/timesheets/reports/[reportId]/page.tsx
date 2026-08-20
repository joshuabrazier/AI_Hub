import ReportView from "@/features/admin-timesheets/views/report.view";

// The id is an identifier for a row, not a grant of access: the admin check in
// the service already decided that, and a missing report answers notFound()
// rather than confirming what does or does not exist.
export default async function AdminTimesheetReport({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <ReportView reportId={reportId} />;
}
