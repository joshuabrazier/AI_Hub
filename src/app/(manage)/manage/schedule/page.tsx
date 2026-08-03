import ManageSchedulePage from "@/features/manage-schedule/manage-schedule.page";

export default async function ManageSchedule({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  return <ManageSchedulePage weekParam={week} />;
}
