import DeliveryTimesheetPage from "@/features/delivery/delivery-timesheet.page";

// `week` is a 'YYYY-MM-DD' anchor and nothing more; the service normalises
// it and falls back to this week.
export default async function PortalTimesheet({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;

  return <DeliveryTimesheetPage eyebrow="Your portal" week={week} />;
}
