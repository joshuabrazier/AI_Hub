"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { askTimesheetQueryAction } from "./admin-timesheets-query.actions";
import { QUERY_MAX_LENGTH } from "./admin-timesheets-query.types";
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
  const [interpretation, setInterpretation] = useState<string | null>(null);
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
          setInterpretation(null);
          toast.error(response.formError ?? "Could not work that out");
          return;
        }

        const { understood, href, interpretation: read, rejected } = response.data;

        // Shown whether or not it worked. A question it could not use is still
        // a question the reader should see its reading of.
        setInterpretation(read);

        if (rejected.length > 0) {
          toast.warning(`I could not find ${rejected.join(" or ")}, so that part was ignored.`);
        }

        if (!understood || !href) return;

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
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={QUERY_MAX_LENGTH}
            disabled={disabled || isPending}
            className="pl-9"
            aria-label="Ask for a view"
            placeholder="Ask for a view - e.g. Philipp's external work last month"
          />
        </div>

        <Button type="submit" variant="outline" disabled={disabled || isPending || !question.trim()} loading={isPending}>
          {isPending ? "Working it out" : "Show me"}
        </Button>
      </form>

      {interpretation && (
        <p className="text-xs text-muted-foreground">
          {/* A text node, not markup. This is the model's own sentence and it
              is rendered as text for the same reason chat replies are. */}
          Read as: {interpretation}
        </p>
      )}
    </div>
  );
}
