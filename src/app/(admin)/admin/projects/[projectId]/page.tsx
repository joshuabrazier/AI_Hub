import DeliveryBoardPage from "@/features/delivery/delivery-board.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

// The project id is a routing parameter and nothing more. It is handed
// straight to the feature page, whose services re-check it against the
// signed-in user's project memberships before reading a card.
export default async function AdminProjectBoard({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <DeliveryBoardPage eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]} projectId={projectId} />;
}
