import OutstandingView from "@/features/admin-timesheets/views/outstanding.view";

// No searchParams: this view takes no period and no filters. See the note at
// the top of the view about why a period control would be a lie here.
export default async function AdminTimesheetOutstanding() {
  return <OutstandingView />;
}
