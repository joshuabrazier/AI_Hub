import PersonView from "@/features/admin-timesheets/views/person.view";

export default async function AdminTimesheetPerson({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ month?: string; category?: string; project?: string; week?: string }>;
}) {
  const { personId } = await params;
  const query = await searchParams;

  return <PersonView personId={decodeURIComponent(personId)} {...query} />;
}
