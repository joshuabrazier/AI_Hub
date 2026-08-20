"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AiChatMarkdown } from "@/features/ai-chat/components/ai-chat-markdown";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { generateTimesheetSummaryAction } from "./admin-timesheets-ai.actions";
import type { TimesheetSummaryDTO } from "./admin-timesheets-ai.types";
import type { TimesheetFiltersDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// The AI summary panel.
//
// RENDERED THROUGH AiChatMarkdown, which parses to an AST and emits React
// elements rather than an HTML string. That matters here for the same reason
// it matters in chat: the model is repeating back job and project names that
// staff typed into Jira, so its output is untrusted twice over. There is no
// dangerouslySetInnerHTML in this feature and adding one would undo the
// argument.
//
// NOTHING GENERATES ON RENDER. The server passes whatever is cached and the
// button is the only thing that spends money, so navigating between periods
// is free. A stale panel keeps showing its old text with a badge saying so -
// better than an empty box, and it stops a sync silently erasing what
// somebody was mid-way through reading.
// -------------------------------------------------------------------
export function AiSummaryPanel({
  summary: initial,
  filters,
  periodLabel,
  index,
}: {
  summary: TimesheetSummaryDTO;
  filters: TimesheetFiltersDTO;
  periodLabel: string;
  index: number;
}) {
  const [summary, setSummary] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const generate = () => {
    startTransition(async () => {
      try {
        const response = await generateTimesheetSummaryAction({
          scope: summary.scope,
          granularity: filters.granularity,
          start: filters.start,
          category: filters.category,
          project: filters.project,
          person: filters.person,
        });

        if (!response.success) {
          toast.error(response.formError ?? "Could not write a summary");
          return;
        }

        setSummary(response.data);

        if (response.data.state === "empty") {
          toast.info("There is nothing logged in this period to summarise.");
        }
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  // Not configured is not a failure to report - the feature is optional, and
  // an admin cannot fix a missing Bedrock token from this screen. Showing
  // nothing is the honest outcome.
  if (!summary.available) return null;

  const hasText = Boolean(summary.summary);

  return (
    <Card style={{ animationDelay: `${index * 60}ms` }}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Summary
          </CardTitle>

          <CardDescription>
            {hasText && summary.generatedAt
              ? `Written ${formatDateTime(summary.generatedAt)} from the figures on this screen.`
              : `An AI reading of ${periodLabel}, written from the figures on this screen.`}
          </CardDescription>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {summary.state === "stale" && <Badge variant="warning">Figures have changed</Badge>}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={generate}
            disabled={isPending}
            loading={isPending}
          >
            {hasText ? "Rewrite" : "Summarise"}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {summary.state === "empty" ? (
          <p className="text-sm text-muted-foreground">
            Nothing was logged in this period, so there is nothing to summarise.
          </p>
        ) : hasText ? (
          <>
            {summary.state === "stale" && (
              <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                The numbers have moved since this was written, most likely a Jira sync. Rewrite it to
                bring it back in step.
              </p>
            )}

            {/* The model's own words. Figures in here were computed by the
                timesheet engine and passed in, never worked out by the model -
                see admin-timesheets-ai.facts.ts. */}
            <AiChatMarkdown content={summary.summary ?? ""} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No summary yet. Press Summarise to have one written from the figures above.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
