import AdminAiChatLogPage from "@/features/admin-ai-chat-log/admin-ai-chat-log.page";
import { GetAiChatLogPageSchema } from "@/features/admin-ai-chat-log/admin-ai-chat-log.types";

// The filter and page are routing parameters and nothing more. They are parsed
// leniently here - a bad value falls back to the default view rather than
// erroring - and the service re-checks the role before reading anything.
export default async function AdminAiChatLog({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; page?: string }>;
}) {
  const { user, page } = await searchParams;

  const parsed = GetAiChatLogPageSchema.safeParse({ userId: user, page: page ?? 1 });

  return <AdminAiChatLogPage filter={parsed.success ? parsed.data : { page: 1 }} />;
}
