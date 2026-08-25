import TranscriptionPage from "@/features/transcription/transcription.page";

// The transcription id is a routing parameter and nothing more. It is
// handed straight to the feature page, whose service re-checks it against
// the signed-in user's own transcriptions before reading one.
export default async function PortalTranscription({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  return <TranscriptionPage eyebrow="Your portal" transcriptionId={id} />;
}
