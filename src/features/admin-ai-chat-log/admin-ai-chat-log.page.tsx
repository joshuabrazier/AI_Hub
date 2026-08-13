import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

import { AiChatLogTable } from "./components/ai-chat-log-table";
import { getAiChatLogPageService } from "./admin-ai-chat-log.service";
import { type GetAiChatLogPageRequestDTO } from "./admin-ai-chat-log.types";

// -------------------------------------------------------------------
// AI chat request log
//
// Exactly what the app sent to the model, per call, for every user.
//
// Admin-only, and the guard lives in the service rather than only in the area
// layout - this is the one screen in the app where one person reads another's
// private content, so it does not rely on being mounted under /admin to be
// safe. Opening a payload writes an audit entry.
// -------------------------------------------------------------------
export default async function AdminAiChatLogPage({ filter }: { filter: GetAiChatLogPageRequestDTO }) {
  const page = await getAiChatLogPageService(filter);

  return (
    <PortalPage
      eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]}
      title="AI chat requests"
      description="Every call sent to the model, with the exact content of each request. Opening a request is recorded in the activity log."
    >
      <AiChatLogTable page={page} />
    </PortalPage>
  );
}
