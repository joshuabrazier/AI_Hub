import AiChatPage from "@/features/ai-chat/ai-chat.page";

// The subject id is a routing parameter and nothing more. It is handed
// straight to the feature page, whose service re-checks it against the
// signed-in user's own conversations before reading a message.
export default async function PortalAiChat({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject } = await searchParams;

  return <AiChatPage eyebrow="Your portal" subjectId={subject} />;
}
