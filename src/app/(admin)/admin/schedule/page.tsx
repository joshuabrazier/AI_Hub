import AdminSchedulePage from "@/features/admin-schedule/admin-schedule.page";

export default async function AdminSchedule({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  return <AdminSchedulePage weekParam={week} />;
}
