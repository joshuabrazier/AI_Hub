import AiChatPage from "@/features/ai-chat/ai-chat.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

// The subject id is a routing parameter and nothing more. It is handed
// straight to the feature page, whose service re-checks it against the
// signed-in user's own conversations before reading a message.
export default async function AdminAiChat({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject } = await searchParams;

  return <AiChatPage eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]} subjectId={subject} />;
}
