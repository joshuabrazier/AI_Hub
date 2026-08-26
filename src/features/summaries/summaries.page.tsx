import PortalPage from "@/features/layout/portal-page";

import { SummariesWorkspace } from "./components/summaries-workspace";
import { getSummariesPageService } from "./summaries.service";

// -------------------------------------------------------------------
// Summaries
//
// One page, rendered identically in all three areas - the feature is per
// person, not per role, so there is nothing for an area to change. The
// three routes under app/ are thin wrappers around this.
//
// It fetches nothing and stores nothing. The only server call it makes is
// the streaming one, when somebody presses Summarise.
// -------------------------------------------------------------------
export default function SummariesPage({ eyebrow }: { eyebrow: string }) {
  const page = getSummariesPageService();

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="Summaries"
      // Says plainly that nothing is kept, because that is the question
      // somebody is entitled to an answer to before pasting a contract in -
      // and because a refresh will lose their summary, which is better
      // learned here than by doing it.
      description="Paste any text and get a summary in the style you need. Nothing is saved, so copy anything you want to keep. Administrators can review the text sent to the model."
    >
      <SummariesWorkspace page={page} />
    </PortalPage>
  );
}
