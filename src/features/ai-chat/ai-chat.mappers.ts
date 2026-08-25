import type { AiChatAttachmentMeta, AiChatMessage } from "@/lib/data/kysely-database-types";
import type { AiChatSubjectWithCount } from "@/lib/data/repositories/ai-chat-subjects.repository";

import { TITLE_MAX_CHARS } from "./ai-chat.types";
import type { AiChatAttachmentDTO, AiChatMessageDTO, AiChatSubjectDTO } from "./ai-chat.types";

// -------------------------------------------------------------------
// Map a conversation row to the sidebar DTO. The message count is carried
// on the row rather than counted per conversation, so the sidebar renders
// from one pass of data.
// -------------------------------------------------------------------
export function mapDBAiChatSubjectToDTO(subject: AiChatSubjectWithCount): AiChatSubjectDTO {
  return {
    id: subject.id,
    title: subject.title,
    messageCount: subject.messageCount,
    lastMessageAt: subject.lastMessageAt,
  };
}

// -------------------------------------------------------------------
// Map one turn to its DTO.
//
// `content` is passed through as the plain text it was stored as. It is
// NOT sanitised here and must never be rendered with
// dangerouslySetInnerHTML: both halves of a conversation are untrusted
// text - the user's half because they typed it, the model's half because a
// model will repeat back whatever it was given.
//
// The user's half renders as a text node. The model's half goes through
// ModelMarkdown, which is NOT an exception to that: it parses to an AST
// and renders React elements, so no HTML string is ever produced and the
// text still reaches the DOM escaped. Nothing in this feature turns stored
// chat content into markup.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// Map one attachment to its DTO.
//
// Takes the metadata row, which has no `bytes` field to leak by accident -
// the type makes it impossible to hand a file's content to the browser
// from here, rather than relying on remembering not to.
//
// `fileName` is passed through untouched. It is the name from the
// uploader's own filesystem, so it is untrusted text and is rendered as a
// text node like message content. The SANITISED name the model is shown is
// a separate thing entirely, derived at send time.
// -------------------------------------------------------------------
export function mapDBAiChatAttachmentToDTO(attachment: AiChatAttachmentMeta): AiChatAttachmentDTO {
  return {
    id: attachment.id,
    kind: attachment.kind,
    format: attachment.format,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    byteSize: attachment.byteSize,
    width: attachment.width,
    height: attachment.height,
  };
}

export function mapDBAiChatMessageToDTO(
  message: AiChatMessage,
  attachments: AiChatAttachmentMeta[] = [],
): AiChatMessageDTO {
  // With caching on, the model reports input in three parts and `inputTokens`
  // alone is only the uncached remainder. Summed once here so no component
  // has to remember the rule - reading inputTokens by itself is exactly the
  // mistake that makes a working cache look broken.
  //
  // Null rather than 0 when none of the three is present, so "no usage was
  // recorded" (a stream that ended early) stays distinguishable from "this
  // turn genuinely cost nothing".
  const parts = [message.inputTokens, message.cacheReadTokens, message.cacheWriteTokens];
  const totalInputTokens = parts.some((part) => part !== null)
    ? parts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
    : null;

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    inputTokens: message.inputTokens,
    outputTokens: message.outputTokens,
    cacheReadTokens: message.cacheReadTokens,
    cacheWriteTokens: message.cacheWriteTokens,
    totalInputTokens,
    attachments: attachments.map(mapDBAiChatAttachmentToDTO),
  };
}

// -------------------------------------------------------------------
// Derive a conversation title from its first user turn.
//
// Collapses whitespace first so a pasted multi-line prompt does not become
// a title with newlines in it, then truncates on a word boundary where one
// is close enough to the limit to look deliberate.
// -------------------------------------------------------------------
export function deriveAiChatSubjectTitle(firstMessage: string): string {
  const collapsed = firstMessage.replace(/\s+/g, " ").trim();

  if (collapsed.length <= TITLE_MAX_CHARS) return collapsed;

  const clipped = collapsed.slice(0, TITLE_MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(" ");

  // Only break on a word if that word ends reasonably near the limit;
  // otherwise a single long token would leave a stub of a title.
  const base = lastSpace > TITLE_MAX_CHARS * 0.6 ? clipped.slice(0, lastSpace) : clipped;

  return `${base.trimEnd()}...`;
}
