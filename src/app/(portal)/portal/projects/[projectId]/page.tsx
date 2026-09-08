import DeliveryBoardPage from "@/features/delivery/delivery-board.page";

// The one id in the portal's path, and it names a PROJECT rather than a
// person: the actor still comes from the session, and the project is
// re-checked against this user's memberships before a single field of it is
// read. A project they are not on answers notFound().
export default async function PortalProjectBoard({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <DeliveryBoardPage eyebrow="Your portal" projectId={projectId} />;
}
