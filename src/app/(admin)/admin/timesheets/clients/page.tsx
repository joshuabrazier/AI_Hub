import type { TimesheetSearchParams } from "@/features/admin-timesheets/admin-timesheets.service";
import ClientsView from "@/features/admin-timesheets/views/clients.view";

export default async function AdminTimesheetsClients({
  searchParams,
}: {
  searchParams: Promise<TimesheetSearchParams>;
}) {
  const params = await searchParams;
  return <ClientsView {...params} />;
}
