import ReportsView from "@/features/admin-timesheets/views/reports.view";

// No searchParams: this is the filing cabinet, not a view of a period. See the
// note in reports.view.tsx.
export default async function AdminTimesheetReports() {
  return <ReportsView />;
}
