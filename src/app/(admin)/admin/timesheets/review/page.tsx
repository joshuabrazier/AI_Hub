import ReviewView from "@/features/admin-timesheets/views/review.view";

export default async function AdminTimesheetReview({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; start?: string; category?: string; project?: string; person?: string }>;
}) {
  const params = await searchParams;
  return <ReviewView {...params} />;
}
