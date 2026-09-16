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
      description="Paste any text and get a summary at the depth you need. Nothing is saved here, so copy anything you want to keep, and administrators can review what is sent to the model."
      // FILL, because the two panes underneath are a before and an after and
      // they have to be the same height to read as one. Without it the page
      // grows to fit its content, which on this screen means a tall box of
      // pasted text beside a short box of summary, and a third of the window
      // left empty below both.
      fill
    >
      <SummariesWorkspace page={page} />
    </PortalPage>
  );
}
