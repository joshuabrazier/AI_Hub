import TranscriptionPage from "@/features/transcription/transcription.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

// The transcription id is a routing parameter and nothing more. It is
// handed straight to the feature page, whose service re-checks it against
// the signed-in user's own transcriptions before reading one.
export default async function ManageTranscription({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  return <TranscriptionPage eyebrow={USER_ROLE_LABELS[USER_ROLES.MANAGER]} transcriptionId={id} />;
}
