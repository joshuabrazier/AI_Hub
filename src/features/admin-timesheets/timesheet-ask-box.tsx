"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import Link from "next/link";

import { askTimesheetQueryAction } from "./admin-timesheets-query.actions";
import { QUERY_MAX_LENGTH, type TimesheetQueryResultDTO } from "./admin-timesheets-query.types";
import type { TimesheetFiltersDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Ask for a view in words.
//
// WHAT IT DOES NOT DO is answer questions. It resolves a question to the
// filters the dashboard already understands and then navigates there, so what
// the reader ends up looking at is the ordinary screen with the ordinary
// figures - computed by the engine, not described by a model. A box that
// answered in prose would be a second source of numbers.
//
// THE INTERPRETATION IS ALWAYS SHOWN, and that is the feature working rather
// than a debugging aid. The failure this guards against is not a wrong page,
// it is a wrong page that looks right: filtered to the wrong person, the
// dashboard is simply quieter, and nothing on it says why. One sentence saying
// what the question was taken to mean makes a misreading visible.
// -------------------------------------------------------------------
export function TimesheetAskBox({
  filters,
  disabled,
}: {
  filters: TimesheetFiltersDTO;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<TimesheetQueryResultDTO | null>(null);
  const [isPending, startTransition] = useTransition();

  const ask = () => {
    const asked = question.trim();
    if (!asked) return;

    startTransition(async () => {
      try {
        const response = await askTimesheetQueryAction({
          question: asked,
          granularity: filters.granularity,
          start: filters.start,
        });

        if (!response.success) {
          setResult(null);
          toast.error(response.formError ?? "Could not work that out");
          return;
        }

        const { understood, href, rejected, answer } = response.data;

        // Kept whether or not it worked. A question it could not use is still a
        // question the reader should see its reading of.
        setResult(response.data);

        if (rejected.length > 0) {
          toast.warning(`I could not find ${rejected.join(" or ")}, so that part was ignored.`);
        }

        if (!understood || !href) return;

        // A question that asked for FIGURES stays put and shows them. Only a
        // request for a view navigates: pushing a route out from under an
        // answer would replace the thing the reader asked for with a page they
        // then have to read themselves.
        if (answer) return;

        router.push(href);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        {/* The gradient edge is on the WRAPPER, not the input - see .ask-bar
            in globals.css for why a real gradient border cannot be rounded.
            A sparkle rather than a magnifier: this asks a model a question, it
            does not filter a list, and a magnifying glass promises the wrong
            thing. */}
        <div className="ask-bar min-w-0 flex-1">
          <div className="relative bg-background">
            <Sparkles
              className={cn(
                "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 transition-colors",
                isPending ? "animate-pulse text-primary" : "text-primary/70",
              )}
              aria-hidden="true"
            />
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={QUERY_MAX_LENGTH}
              disabled={disabled || isPending}
              className="border-transparent bg-transparent pl-9 shadow-none focus-visible:ring-0"
              aria-label="Ask for a view"
              placeholder="Ask a question - e.g. what did Philipp cost us last month?"
            />
          </div>
        </div>

        <Button type="submit" variant="outline" disabled={disabled || isPending || !question.trim()} loading={isPending}>
          {isPending ? "Working it out" : "Show me"}
        </Button>
      </form>

      {result && (
        <p className="text-xs text-muted-foreground">
          {/* A text node, not markup. This is the model's own sentence and it
              is rendered as text for the same reason chat replies are. */}
          Read as: {result.interpretation}
        </p>
      )}

      {result?.answer && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {result.answer.scope}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {result.answer.measures.map((measure) => (
              <div key={measure.key}>
                <dt className="text-xs font-medium text-muted-foreground">{measure.label}</dt>
                <dd className="mt-0.5 font-heading text-xl font-semibold text-foreground">{measure.value}</dd>
                {/* The caveat sits WITH the figure, not in a footnote. An
                    understated value or an unavailable margin presented bare
                    is the thing that actually misleads. */}
                {measure.caveat && <dd className="mt-0.5 text-xs text-muted-foreground">{measure.caveat}</dd>}
              </div>
            ))}
          </dl>

          {result.href && (
            <p className="mt-4">
              <Link href={result.href} className="text-sm underline underline-offset-4">
                Open this view
              </Link>
            </p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Figures computed from the timesheet data, not written by the model.
          </p>
        </div>
      )}
    </div>
  );
}
