import type { TimesheetSearchParams } from "@/features/admin-timesheets/admin-timesheets.service";
import PersonView from "@/features/admin-timesheets/views/person.view";

export default async function AdminTimesheetPerson({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<TimesheetSearchParams>;
}) {
  const { personId } = await params;
  const query = await searchParams;

  return <PersonView personId={decodeURIComponent(personId)} {...query} />;
}
