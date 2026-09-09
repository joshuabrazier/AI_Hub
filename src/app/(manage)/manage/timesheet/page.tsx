import DeliveryTimesheetPage from "@/features/delivery/delivery-timesheet.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

// `week` is a 'YYYY-MM-DD' anchor and nothing more; the service normalises
// it and falls back to this week.
export default async function ManageTimesheet({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;

  return <DeliveryTimesheetPage eyebrow={USER_ROLE_LABELS[USER_ROLES.MANAGER]} week={week} />;
}
