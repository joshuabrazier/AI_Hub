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
// It reads this person's own saved summaries and nothing else. The list
// query deliberately does not load the pasted material or the answers; see
// the repository.
// -------------------------------------------------------------------
export default async function SummariesPage({ eyebrow }: { eyebrow: string }) {
  const page = await getSummariesPageService();

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="Summaries"
      // -----------------------------------------------------------------
      // SAYS WHAT IS KEPT, because somebody is entitled to that answer
      // BEFORE pasting a contract in rather than afterwards.
      //
      // This page used to say the opposite - "Nothing is saved" - which was
      // true then and would be a lie now. A sentence about somebody's data
      // and the table behind it must change in the same commit, which is
      // why the migration says so too.
      // -----------------------------------------------------------------
      description="Paste any text and get a summary in the style you need. Both the text and the summary are saved to your account so you can come back to them - nobody else can see them, and you can delete any of them. Administrators can review the text sent to the model."
      // FILL, so the answer panel is a full column rather than a short box
      // floating beside a tall one. The two halves being the same height is
      // most of what makes this read as before-and-after.
      fill
    >
      <SummariesWorkspace page={page} />
    </PortalPage>
  );
}
