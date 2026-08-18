import ReviewView from "@/features/admin-timesheets/views/review.view";

export default async function AdminTimesheetReview({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string; project?: string; person?: string; week?: string }>;
}) {
  const params = await searchParams;
  return <ReviewView {...params} />;
}
