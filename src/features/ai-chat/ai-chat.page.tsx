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
      // NO VISIBLE HEADER on this screen. The eyebrow and title only repeated
      // what the sidebar already highlights, and the description was a fourth
      // line of grey above a page whose whole content is the transcript. The
      // h1 is still rendered for the document outline - see PortalPage.
      //
      // The privacy terms are NOT lost with the description: they live on the
      // greeting shown for a new conversation, which is where they are read at
      // the moment somebody is deciding what to type. See the empty state in
      // ai-chat-thread.tsx. If that text ever goes, this page has nowhere left
      // to say it and both need rethinking together.
      headerHidden
      // The composer is the bottom edge of this screen, so the page is sized
      // to the viewport and the transcript scrolls inside it. See PortalPage.
      fill
    >
      <AiChatWorkspace page={page} />
    </PortalPage>
  );
}
