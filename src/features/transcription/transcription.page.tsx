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
//
// A meeting imported from Teams says so plainly in the description, because
// "the recording is kept" is not true of one - Teams transcribed it and no
// audio ever reached this app.
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
      // Says plainly how long a recording is kept, because that is the
      // question somebody is entitled to an answer to before they record a
      // room full of people - and because "private from other users" is a
      // promise the app has to keep rather than a nicety.
      description="Record a meeting, upload one, or import one Teams has already transcribed, and get a transcript and a summary. Your transcriptions are private from other users, and any recording is kept so you can download it."
    >
      <TranscriptionWorkspace page={page} />
    </PortalPage>
  );
}
