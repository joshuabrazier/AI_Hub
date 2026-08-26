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
      // ONE LINE HERE, and the full terms on the empty thread.
      //
      // What has to be said has not changed: administrators can read what is
      // sent, and timesheet answers are limited to what a role can already
      // see. A privacy promise the product does not keep is worse than no
      // promise, and so is one nobody reads - four lines of grey text above
      // every visit is the second failure, not a fix for the first.
      //
      // So it moved to the greeting on a new conversation, which is read at
      // the moment somebody is deciding what to type. See the empty state in
      // ai-chat-thread.tsx; if that text goes, this line is not enough on its
      // own and both need rewriting together.
      description="Ask about this app, or about your timesheets."
      // The composer is the bottom edge of this screen, so the page is sized
      // to the viewport and the transcript scrolls inside it. See PortalPage.
      fill
    >
      <AiChatWorkspace page={page} />
    </PortalPage>
  );
}
