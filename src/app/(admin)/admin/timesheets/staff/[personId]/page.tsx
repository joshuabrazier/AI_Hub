import PersonView from "@/features/admin-timesheets/views/person.view";

export default async function AdminTimesheetPerson({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ granularity?: string; start?: string; category?: string; project?: string }>;
}) {
  const { personId } = await params;
  const query = await searchParams;

  return <PersonView personId={decodeURIComponent(personId)} {...query} />;
}
