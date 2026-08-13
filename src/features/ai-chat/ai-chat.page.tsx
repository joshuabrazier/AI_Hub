import PortalPage from "@/features/layout/portal-page";

import { AiChatWorkspace } from "./components/ai-chat-workspace";
import { getAiChatPageService } from "./ai-chat.service";

// -------------------------------------------------------------------
// AI chat
//
// One page, rendered identically in all three areas - the feature is per
// person, not per role, so there is nothing for an area to change. The
// three routes under app/ are thin wrappers around this.
//
// Everything on it belongs to the signed-in user, resolved from the session
// inside the service. `subjectId` selects which conversation to open and is
// re-checked against the session there; an id that is not theirs falls back
// to their most recent conversation rather than erroring.
// -------------------------------------------------------------------
export default async function AiChatPage({ eyebrow, subjectId }: { eyebrow: string; subjectId?: string }) {
  const page = await getAiChatPageService(subjectId);

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="AI chat"
      description="Ask anything. Each conversation keeps its own history, and only you can see it."
    >
      <AiChatWorkspace page={page} />
    </PortalPage>
  );
}
