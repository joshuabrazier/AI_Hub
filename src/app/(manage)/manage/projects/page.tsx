import DeliveryProjectsPage from "@/features/delivery/delivery-projects.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

export default async function ManageProjects() {
  return <DeliveryProjectsPage eyebrow={USER_ROLE_LABELS[USER_ROLES.MANAGER]} />;
}
