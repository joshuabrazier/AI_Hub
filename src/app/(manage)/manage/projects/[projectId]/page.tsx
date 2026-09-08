import DeliveryBoardPage from "@/features/delivery/delivery-board.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

// The project id is a routing parameter and nothing more. Managing a team
// grants nothing on a project: the feature page's services resolve access
// from project membership, and a project this manager is not on answers
// notFound().
export default async function ManageProjectBoard({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <DeliveryBoardPage eyebrow={USER_ROLE_LABELS[USER_ROLES.MANAGER]} projectId={projectId} />;
}
