import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import {
  AI_CHAT_REQUEST_KIND_LABELS,
  USER_ROLES,
  type AiChatRequestKind,
} from "@/lib/data/kysely-database-types";
import {
  countAiChatRequestLogsRepo,
  getAiChatRequestLogByIdRepo,
  getAiChatRequestLogUsersRepo,
  getAiChatRequestLogsRepo,
  type AiChatRequestLogWithUser,
} from "@/lib/data/repositories/ai-chat-request-logs.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";

import {
  AI_CHAT_LOG_PAGE_SIZE,
  type AiChatLogPageDTO,
  type AiChatRequestLogDetailDTO,
  type AiChatRequestLogRowDTO,
  type GetAiChatLogPageRequestDTO,
  type GetAiChatRequestLogDetailRequestDTO,
  type LoggedMessageDTO,
} from "./admin-ai-chat-log.types";

// -------------------------------------------------------------------
// AI chat request log - admin review of what is sent to the model.
//
// THIS IS THE ONE PLACE ONE PERSON'S CHAT CONTENT IS READABLE BY ANOTHER.
// Everywhere else in the chat feature, a conversation is scoped to its owner
// by a userId predicate. Here the query is deliberately unscoped and the ADMIN
// ROLE is the entire boundary, so requireUserRole([ADMIN]) opens every export
// below without exception. There is no manager tier: a manager's scope is
// their teams, and chat has nothing to do with teams.
//
// Reading a payload is itself a privileged act, so getRequestDetail records an
// audit entry naming the admin who opened it and the person whose words they
// read. The list does not: it carries no message content, and auditing a
// glance at a table would bury the reads that matter.
// -------------------------------------------------------------------

// Input as actually billed. With caching on, `inputTokens` alone is only the
// uncached remainder - the same trap the chat UI had to avoid.
function totalInput(log: AiChatRequestLogWithUser): number | null {
  const parts = [log.inputTokens, log.cacheReadTokens, log.cacheWriteTokens];

  return parts.some((part) => part !== null)
    ? parts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
    : null;
}

function toRow(log: AiChatRequestLogWithUser): AiChatRequestLogRowDTO {
  // JSONB comes back parsed. Defended anyway: a row written by an older
  // version of this app, or truncated mid-write, should render as an empty
  // conversation rather than crash the page an admin is using to investigate.
  const messages = Array.isArray(log.messages) ? log.messages : [];

  return {
    id: log.id,
    userId: log.userId,
    userName: log.userName,
    userEmail: log.userEmail,
    subjectId: log.subjectId,
    kind: log.kind,
    kindLabel: AI_CHAT_REQUEST_KIND_LABELS[log.kind as AiChatRequestKind] ?? log.kind,
    createdAt: log.createdAt,
    durationMs: log.durationMs,
    messageCount: messages.length,
    totalInputTokens: totalInput(log),
    outputTokens: log.outputTokens,
    cacheReadTokens: log.cacheReadTokens,
    truncated: log.truncated,
    error: log.error,
  };
}

// -------------------------------------------------------------------
// The log, newest first, optionally filtered to one person.
// -------------------------------------------------------------------
export async function getAiChatLogPageService(
  requestDTO: GetAiChatLogPageRequestDTO,
): Promise<AiChatLogPageDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const [totalRows, users] = await Promise.all([
      countAiChatRequestLogsRepo(requestDTO.userId),
      getAiChatRequestLogUsersRepo(),
    ]);

    const pageCount = Math.max(1, Math.ceil(totalRows / AI_CHAT_LOG_PAGE_SIZE));
    // Clamped so a hand-edited page number lands on a real page instead of an
    // empty one.
    const page = Math.min(Math.max(1, requestDTO.page), pageCount);

    const logs = await getAiChatRequestLogsRepo({
      userId: requestDTO.userId,
      limit: AI_CHAT_LOG_PAGE_SIZE,
      offset: (page - 1) * AI_CHAT_LOG_PAGE_SIZE,
    });

    return {
      rows: logs.map(toRow),
      users,
      // Only echoed back if it matches somebody who actually has calls, so a
      // stale id in the URL does not leave the control showing a filter that
      // is not being applied.
      filteredUserId: users.some((user) => user.id === requestDTO.userId)
        ? (requestDTO.userId ?? null)
        : null,
      page,
      pageCount,
      totalRows,
    };
  } catch (error) {
    throw handleError("getAiChatLogPageService", error);
  }
}

// -------------------------------------------------------------------
// One call in full, including every word sent.
//
// Audited. An admin reading somebody's private conversation is exactly the
// kind of privileged act the trail exists for, and the entry names both
// parties so the read is attributable long after the log row is purged.
// -------------------------------------------------------------------
export async function getAiChatRequestLogDetailService(
  requestDTO: GetAiChatRequestLogDetailRequestDTO,
): Promise<AiChatRequestLogDetailDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const log = await getAiChatRequestLogByIdRepo(requestDTO.logId);

    if (!log) {
      throw new DisplayErrorMessage("That request is no longer in the log.");
    }

    const messages: LoggedMessageDTO[] = Array.isArray(log.messages) ? log.messages : [];
    const systemBlocks = Array.isArray(log.systemBlocks)
      ? log.systemBlocks.map((block) => block.text)
      : [];

    // Recorded before returning, so the trail cannot be dodged by abandoning
    // the response. The content itself is never copied into the audit entry -
    // that would duplicate the private text into a table with a much longer
    // retention window.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.AI_CHAT_REQUEST_VIEWED,
      entityType: AUDIT_ENTITY_TYPES.AI_CHAT_REQUEST,
      entityId: log.id,
      subjectUserId: log.userId,
      summary: `Viewed the full AI chat request sent by ${log.userName}`,
      metadata: { kind: log.kind, messageCount: messages.length, subjectId: log.subjectId },
    });

    return {
      ...toRow(log),
      modelId: log.modelId,
      region: log.region,
      systemBlocks,
      messages,
      inputTokens: log.inputTokens,
      cacheWriteTokens: log.cacheWriteTokens,
    };
  } catch (error) {
    throw handleError("getAiChatRequestLogDetailService", error);
  }
}
