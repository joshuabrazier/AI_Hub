import SummariesPage from "@/features/summaries/summaries.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

export default function ManageSummaries() {
  return <SummariesPage eyebrow={USER_ROLE_LABELS[USER_ROLES.MANAGER]} />;
}
