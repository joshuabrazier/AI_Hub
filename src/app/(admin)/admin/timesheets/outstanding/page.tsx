import OutstandingView, { type OutstandingSearchParams } from "@/features/admin-timesheets/views/outstanding.view";

// Client and project only. No period: see the note at the top of the view
// about why a month control would be a lie on this screen.
export default async function AdminTimesheetOutstanding({
  searchParams,
}: {
  searchParams: Promise<OutstandingSearchParams>;
}) {
  const params = await searchParams;
  return <OutstandingView {...params} />;
}
