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
      // Says plainly that administrators can read what is sent. The earlier
      // wording ("only you can see it") stopped being true the moment the
      // request log shipped, and a privacy promise the product does not keep
      // is worse than no promise at all.
      description="Ask anything. Each conversation keeps its own history and is private from other users. Administrators can review the requests sent to the model."
    >
      <AiChatWorkspace page={page} />
    </PortalPage>
  );
}
