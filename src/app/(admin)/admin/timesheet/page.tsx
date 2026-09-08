import DeliveryTimesheetPage from "@/features/delivery/delivery-timesheet.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

// `week` is a 'YYYY-MM-DD' anchor and nothing more. It is handed straight to
// the feature page, whose service normalises it: an unusable or tampered
// value falls back to this week rather than erroring, and the week it
// settled on is in the DTO.
export default async function AdminTimesheet({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;

  return <DeliveryTimesheetPage eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]} week={week} />;
}
