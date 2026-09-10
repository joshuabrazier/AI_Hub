"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FileWarning,
  Image as ImageIcon,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { AppDialog } from "@/components/app-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/ai/attachment-formats";
import { MESSAGES } from "@/lib/constants";
import { AI_CHAT_ATTACHMENT_KINDS, AI_CHAT_REQUEST_KINDS } from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { getAiChatRequestLogDetailAction } from "../admin-ai-chat-log.actions";
import type {
  AiChatLogPageDTO,
  AiChatRequestLogDetailDTO,
  LoggedPhaseDTO,
  LoggedPhaseSummaryDTO,
} from "../admin-ai-chat-log.types";

// -------------------------------------------------------------------
// AiChatLogTable
//
// The list of calls, plus the dialog that shows one in full.
//
// Filter and page live in the URL rather than in state, so a filtered view is
// linkable and survives a refresh - useful when an admin is investigating one
// person's usage and wants to send somebody the same view. Both are
// re-validated server-side, so neither grants anything.
//
// The payload is fetched on demand rather than shipped with the list. That is
// not only for weight: fetching it is what writes the audit entry, so a
// payload that was never opened was never read.
// -------------------------------------------------------------------
export function AiChatLogTable({ page }: { page: AiChatLogPageDTO }) {
  const router = useRouter();
  const pathname = usePathname();

  const [isPending, startTransition] = useTransition();
  const [detail, setDetail] = useState<AiChatRequestLogDetailDTO | null>(null);

  const navigate = (userId: string | null, pageNumber: number) => {
    const params = new URLSearchParams();
    if (userId) params.set("user", userId);
    if (pageNumber > 1) params.set("page", String(pageNumber));

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const openDetail = (logId: string) =>
    startTransition(async () => {
      try {
        const response = await getAiChatRequestLogDetailAction({ logId });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setDetail(response.data);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <>
      {/* Filter */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="ai-chat-log-user">Filter by user</Label>
          <select
            id="ai-chat-log-user"
            value={page.filteredUserId ?? ""}
            onChange={(event) => navigate(event.target.value || null, 1)}
            className="h-9 min-w-64 rounded-md border bg-background px-2 text-sm font-medium text-foreground shadow-sm"
          >
            <option value="">Everyone</option>
            {page.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.requestCount})
              </option>
            ))}
          </select>
        </div>

        <p className="pb-2 text-sm text-muted-foreground">
          {page.totalRows === 0
            ? "No requests recorded yet."
            : `${page.totalRows} request${page.totalRows === 1 ? "" : "s"}`}
        </p>
      </div>

      {page.rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border px-6 py-16 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Sparkles size={22} aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-foreground">Nothing to show</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Requests appear here as soon as anything asks the model - a chat turn, a meeting or text
            summary, a filing decision or a timesheet question.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Kind</th>
                <th className="px-4 py-3 font-semibold">Turns sent</th>
                <th className="px-4 py-3 font-semibold">Tokens (in / out)</th>
                <th className="px-4 py-3 font-semibold">Cached</th>
                <th className="px-4 py-3 font-semibold">Took</th>
                <th className="px-4 py-3 font-semibold">Content</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block font-medium text-foreground">{row.userName}</span>
                    <span className="block text-xs text-muted-foreground">{row.userEmail}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={row.kind === AI_CHAT_REQUEST_KINDS.SUMMARY ? "secondary" : "outline"}
                    >
                      {row.kindLabel}
                    </Badge>
                    {row.error && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-destructive">
                        <TriangleAlert size={12} aria-hidden="true" />
                        Failed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                    {row.messageCount}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                    {row.totalInputTokens ?? "-"} / {row.outputTokens ?? "-"}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                    {row.cacheReadTokens ? row.cacheReadTokens : "-"}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                    {row.durationMs === null ? "-" : `${row.durationMs}ms`}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => openDetail(row.id)}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {page.pageCount > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous page"
            disabled={page.page <= 1}
            onClick={() => navigate(page.filteredUserId, page.page - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <span className="tabular-nums text-foreground">
            Page {page.page} of {page.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="Next page"
            disabled={page.page >= page.pageCount}
            onClick={() => navigate(page.filteredUserId, page.page + 1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* The full payload */}
      <AppDialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        title="Request sent to the model"
        description={detail ? `${detail.userName} - ${formatDateTime(detail.createdAt)}` : undefined}
        contentClassName="sm:max-w-4xl"
      >
        {detail && <RequestPayload detail={detail} />}
      </AppDialog>
    </>
  );
}

// -------------------------------------------------------------------
// One request, in full.
//
// Every piece of content here is rendered as a TEXT NODE. It is somebody's
// chat transcript - a model's own output included - so it is untrusted for
// exactly the reasons the chat view is, and this screen has the added
// property that its reader is an admin.
// -------------------------------------------------------------------
function RequestPayload({ detail }: { detail: AiChatRequestLogDetailDTO }) {
  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      {/* What it cost and where it went */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm sm:grid-cols-3">
        <Fact label="Model" value={detail.modelId} mono />
        <Fact label="Region" value={detail.region} mono />
        <Fact label="Kind" value={detail.kindLabel} />
        <Fact label="Input (total)" value={detail.totalInputTokens?.toLocaleString() ?? "-"} mono />
        <Fact label="Uncached input" value={detail.inputTokens?.toLocaleString() ?? "-"} mono />
        <Fact label="Output" value={detail.outputTokens?.toLocaleString() ?? "-"} mono />
        <Fact label="Cache read" value={detail.cacheReadTokens?.toLocaleString() ?? "-"} mono />
        <Fact label="Cache write" value={detail.cacheWriteTokens?.toLocaleString() ?? "-"} mono />
        <Fact label="Duration" value={detail.durationMs === null ? "-" : `${detail.durationMs}ms`} mono />
      </dl>

      {detail.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Call failed</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-foreground">
            {detail.error}
          </p>
        </div>
      )}

      {detail.phases && detail.phaseSummary && (
        <PhaseTimeline phases={detail.phases} summary={detail.phaseSummary} />
      )}

      {detail.truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-data-caution/40 bg-data-caution-surface p-3 text-sm text-data-caution-text">
          <FileWarning size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            This payload was too large to store whole, so what follows is the start of it rather than the
            complete request.
          </span>
        </div>
      )}

      {/* System blocks */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          System ({detail.systemBlocks.length})
        </h3>
        <div className="mt-2 space-y-2">
          {detail.systemBlocks.map((text, index) => (
            <pre
              key={index}
              className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-foreground"
            >
              {text}
            </pre>
          ))}
        </div>
      </section>

      {/* Messages, in the order they were sent */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Messages ({detail.messages.length})
        </h3>
        <ol className="mt-2 space-y-2">
          {detail.messages.map((message, index) => (
            <li key={index} className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>
                  {index + 1}. {message.role}
                </span>
                {/* Where the cache breakpoint sat. Usually the last turn - if
                    it is not, that is why the call cost full price. */}
                {message.cachePoint && (
                  <Badge variant="secondary" className="font-normal normal-case">
                    cache point
                  </Badge>
                )}
              </p>
              <p
                className={cn(
                  "mt-1.5 whitespace-pre-wrap break-words text-sm",
                  message.text ? "text-foreground" : "italic text-muted-foreground",
                )}
              >
                {message.text || "(no text in this block)"}
              </p>

              {/* Files sent with this turn.
                  METADATA ONLY, AND DELIBERATELY SO. This screen exists so
                  somebody is accountable for what the organisation sends to a
                  third-party model and what it costs, and a name, type and
                  size answers that. The file itself is not copied here and is
                  not reachable from here - the download route serves an
                  attachment only to the person who uploaded it, with no admin
                  override. Widening that is a decision about the privacy
                  promise on the chat page, not a UI change. */}
              {message.attachments && message.attachments.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {message.attachments.map((attachment, attachmentIndex) => (
                    <li key={attachmentIndex}>
                      <Badge variant="outline" className="gap-1.5 font-normal">
                        {attachment.kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE ? (
                          <ImageIcon size={12} aria-hidden="true" />
                        ) : (
                          <FileText size={12} aria-hidden="true" />
                        )}
                        {/* The SANITISED name - the one the model was shown.
                            Images carry no name in Converse, so they show as
                            their format alone. */}
                        <span>{attachment.name ?? attachment.format}</span>
                        <span className="text-muted-foreground">
                          {attachment.format} &middot; {formatBytes(attachment.byteSize)}
                        </span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-foreground", mono && "font-mono text-xs tabular-nums")}>{value}</dd>
    </div>
  );
}

// ===================================================================
// WHERE THE TIME WENT
//
// The panel this whole investigation was missing. The duration figure above
// says a call took twenty-one seconds; this says nineteen of them were spent
// compacting the conversation before the model was asked anything - which is
// the difference between knowing a call was slow and knowing why.
//
// A BAR PER PHASE, SCALED TO THE SLOWEST, because the useful reading is
// comparative. "compaction 19.6s" means nothing until you can see beside it
// that reading the history took 0.3s, and a table of numbers makes the eye
// do work a bar does for free.
//
// THE BUDGET IS SHOWN, NOT JUST THE ELAPSED TIME. A phase at 19.6s of a 75s
// budget is healthy; the same 19.6s against a 20s budget is a phase about to
// fail, and those are opposite findings from the same number.
//
// AND THE KIND IS SHOWN, because an idle budget and a duration budget mean
// different things. An idle phase that ran for four minutes was streaming
// happily the whole time and is not slow at all. Reading it as a total is
// exactly the mistake that produced a wall-clock deadline and truncated
// every long reply.
// ===================================================================
function PhaseTimeline({
  phases,
  summary,
}: {
  phases: LoggedPhaseDTO[];
  summary: LoggedPhaseSummaryDTO;
}) {
  // Scaled to the slowest phase rather than to the turn total, so a turn
  // dominated by one stage still shows the small ones as visible slivers
  // instead of nothing at all.
  const slowest = Math.max(...phases.map((phase) => phase.ms), 1);

  const notes = Object.entries(summary.notes);

  return (
    <section className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Where the time went
        </h3>
        <p className="font-mono text-xs text-muted-foreground">{formatMs(summary.totalMs)} total</p>
      </div>

      {/* The finding, when there is one. Said before the bars, because
          somebody opening a failed row is looking for this sentence and
          should not have to read a chart to find it. */}
      {summary.readerLeft && (
        <p className="mt-2 text-xs text-muted-foreground">
          The reader disconnected before the reply finished. Not a fault.
        </p>
      )}

      {summary.ceilingHit && (
        <p className="mt-2 text-xs text-foreground">
          Nothing reached the reader before the overall ceiling. Every stage was inside its own budget;
          there were too many of them.
        </p>
      )}

      <ul className="mt-3 space-y-1.5">
        {phases.map((phase, index) => (
          // Indexed as well as named: a turn with tool rounds enters
          // model-reply more than once, and two rows with the same name are
          // two different stretches of time rather than a duplicate.
          <li key={`${phase.name}-${index}`} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
            <span className="truncate font-mono text-xs text-muted-foreground" title={phase.name}>
              {phase.name}
            </span>

            <span className="h-2 rounded-full bg-border/60" aria-hidden="true">
              <span
                className={cn(
                  "block h-2 rounded-full",
                  phase.timedOut ? "bg-destructive" : "bg-primary/60",
                )}
                style={{ width: `${Math.max(2, (phase.ms / slowest) * 100)}%` }}
              />
            </span>

            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatMs(phase.ms)}
              <span className="text-muted-foreground">
                {" / "}
                {formatMs(phase.budgetMs)}
                {phase.kind === "idle" ? " idle" : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {summary.timedOutPhase !== null && !summary.ceilingHit && (
        <p className="mt-3 text-xs text-foreground">
          <span className="font-mono">{summary.timedOutPhase}</span> is the phase whose budget ran out.
        </p>
      )}

      {/* Counts, not content. What the turn was carrying is often the
          explanation for why a phase was slow - forty turns and six
          attachments is a different call from two and none. */}
      {notes.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
          {notes.map(([key, value]) => (
            <div key={key} className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted-foreground">{key}</dt>
              <dd className="font-mono text-xs text-foreground">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// Seconds once a phase is past a second, milliseconds below that. A phase
// reported as "0.1s" hides the difference between 60ms and 140ms, which is
// the difference between a warm connection and a cold one.
function formatMs(ms: number): string {
  return ms < 1_000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
