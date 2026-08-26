import type { TimesheetSearchParams } from "@/features/admin-timesheets/admin-timesheets.service";
import ReviewView from "@/features/admin-timesheets/views/review.view";

export default async function AdminTimesheetReview({
  searchParams,
}: {
  searchParams: Promise<TimesheetSearchParams>;
}) {
  const params = await searchParams;
  return <ReviewView {...params} />;
}
