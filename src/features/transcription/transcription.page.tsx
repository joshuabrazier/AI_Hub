import PortalPage from "@/features/layout/portal-page";

import { TranscriptionWorkspace } from "./components/transcription-workspace";
import { getTranscriptionPageService } from "./transcription.service";

// -------------------------------------------------------------------
// Transcription
//
// One page, rendered identically in all three areas - the feature is per
// person, not per role, so there is nothing for an area to change. The
// three routes under app/ are thin wrappers around this.
//
// Everything on it belongs to the signed-in user, resolved from the session
// inside the service. `transcriptionId` selects which one to open and is
// re-checked against the session there; an id that is not theirs falls back
// to their most recent rather than erroring.
//
// The service also advances any of this person's unfinished jobs as part of
// building the page, which is what makes a transcription survive somebody
// closing the tab on it.
// -------------------------------------------------------------------
export default async function TranscriptionPage({
  eyebrow,
  transcriptionId,
}: {
  eyebrow: string;
  transcriptionId?: string;
}) {
  const page = await getTranscriptionPageService(transcriptionId);

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="Transcription"
      // Says plainly what happens to the recording, because deleting it is
      // a promise rather than an implementation detail - and because it is
      // the answer to the question somebody is about to ask before they
      // record a meeting.
      description="Record a meeting or upload one, and get a transcript and a summary. Your transcriptions are private from other users, and the recording is deleted once its transcript is saved."
    >
      <TranscriptionWorkspace page={page} />
    </PortalPage>
  );
}
