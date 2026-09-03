import "server-only";

import type { Tool, ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";

import {
  getTimesheetChatFactsService,
  type TimesheetChatFactsRequest,
} from "@/features/admin-timesheets/timesheet-chat-facts.service";

// -------------------------------------------------------------------
// The tools the chat may call.
//
// ONE TOOL, AND IT ONLY READS. That is deliberate and worth keeping: every
// argument below narrows a query, none of them writes anything, and the
// widest thing the model can achieve by calling it is to see figures the
// caller could already have opened a page to read. The scope is decided from
// the SESSION inside the service, never from these arguments - see the header
// of timesheet-chat-facts.service.ts for why that distinction carries the
// whole feature.
//
// ADDING TOOLS CHANGED A DOCUMENTED ASSUMPTION. sanitizeDocumentName's
// reasoning said in as many words that chat had no tools and no sharing, so a
// prompt-injected filename could not reach anything. It can now reach this
// one - and this one is read-only, session-scoped and returns finished
// numbers, which is exactly why those three properties are not incidental.
// A tool that wrote, or that took a user id as an argument, would need that
// reasoning redone from the start rather than extended.
// -------------------------------------------------------------------

export const TIMESHEET_TOOL_NAME = "get_timesheet_figures";

// How many times the model may call a tool before we insist on a reply.
// A cap rather than a guard against anything in particular: each round trip
// is a paid request, and a model that loops is a bill that grows without
// anybody watching it. Four is enough to compare two periods and check a name.
export const MAX_TOOL_ROUNDS = 4;

const TIMESHEET_TOOL: Tool = {
  toolSpec: {
    name: TIMESHEET_TOOL_NAME,
    description: [
      "Look up timesheet figures for a period. Returns hours, billable split, utilisation against contracted",
      "capacity, and - for administrators - chargeable value, cost, margin, and what work is still outstanding.",
      "",
      "TWO DIFFERENT THINGS ARE CALLED TIME LEFT AND YOU MUST NOT CONFUSE THEM.",
      "capacity.contractedHours is how many hours the PEOPLE are contracted for in the period - a staffing figure.",
      "outstanding.workLeftHours is how much WORK is left to do on the jobs, from their estimates minus what has",
      "been logged - a delivery figure. \"How much time is left on Phase 2\", \"how much is left to do\" and \"how",
      "much work remains\" all mean outstanding.workLeftHours. Answering one with the other is the worst mistake",
      "available here, because both are real numbers and the wrong one is completely convincing.",
      "",
      "THERE ARE ALSO TWO KINDS OF WORK LEFT, and both are correct. outstanding.workLeftHours is what the open",
      "tasks are estimated at. outstanding.budgetLeftHours is everything committed less everything spent, so a",
      "task estimated at 10 hours that took 2 gives 8 hours back to the project. They differ whenever an",
      "estimate was wrong, which is usually. When they differ, give both and say which is which - quoting one",
      "as though it were the whole answer is how work left gets mistaken for budget left. A null budgetLeftHours",
      "means nothing was committed to measure against, not that the budget is spent.",
      "",
      "THE OUTSTANDING BLOCK IS NOT ABOUT THE PERIOD - it describes right now. Its note says so, and says whether",
      "the figure is a floor, because most work is not estimated. Repeat what that note says rather than giving",
      "workLeftHours bare. A null workLeftHours means nothing in scope is estimated: say so, never say zero.",
      "It also carries what FINISHED work was estimated at against what it actually took, which is the evidence",
      "for whether the estimates behind the remaining figure are worth anything.",
      "",
      "Every figure returned is already calculated. Report them as given: never add, divide or convert them,",
      "and never work out a percentage or a rate yourself. If a figure you want is not in the result, say it is",
      "not available rather than deriving it.",
      "",
      "The result carries a `scope` object saying what was actually applied, including a `notes` list. If notes",
      "are present, tell the user what they say - they mean something asked for could not be honoured, and an",
      "answer that ignores them describes a different question from the one that was asked.",
      "",
      "It also carries `available.people`, `available.clients` and `available.projects`. If a name was not found,",
      "use those lists to ask which was meant rather than guessing.",
      "",
      "Call this again with different arguments to compare periods. Do not ask the user for a date format;",
      "work out the period from what they said and today's date.",
    ].join(" "),
    inputSchema: {
      json: {
        type: "object",
        properties: {
          granularity: {
            type: "string",
            enum: ["week", "fortnight", "month", "year"],
            description: "How long a period to report. Defaults to month.",
          },
          start: {
            type: "string",
            description:
              "Any date inside the wanted period, as YYYY-MM-DD. It is snapped to the start of its period, so any day in August returns August. Defaults to the current period.",
          },
          person: {
            type: "string",
            description:
              "A person's name, to narrow to their time. Administrators only - for anybody else this is ignored and only their own time is returned, which the notes will say.",
          },
          client: {
            type: "string",
            description: "A client name, to narrow to work for them. Administrators only.",
          },
          project: {
            type: "string",
            description:
              "A piece of work to narrow to, by name - for example \"Phase 2\". Administrators only. Use what the user called it; if it is not found the notes say so and available.projects lists what there was.",
          },
          category: {
            type: "string",
            description: "Usually Internal or External, to narrow to one kind of work.",
          },
          billable: {
            type: "string",
            enum: ["all", "Billable", "Non-billable", "unset"],
            description: "Narrow to one billable state. 'unset' means nobody has said whether the time bills.",
          },
        },
        required: [],
      },
    },
  },
};

export const CHAT_TOOL_CONFIG: ToolConfiguration = { tools: [TIMESHEET_TOOL] };

// -------------------------------------------------------------------
// Run a tool the model asked for.
//
// Returns a JSON-serialisable result, ALWAYS - including for a failure. A
// thrown error here would abandon a half-streamed reply, where a result
// saying what went wrong lets the model tell the user in a sentence.
//
// An unknown tool name is a bug or a hallucination, and is answered rather
// than executed. There is deliberately no dynamic dispatch on the name.
// -------------------------------------------------------------------
export async function runChatTool(name: string, input: unknown): Promise<unknown> {
  if (name !== TIMESHEET_TOOL_NAME) {
    return { error: `No tool called ${name} exists.` };
  }

  // The model's arguments are untrusted, like anything else it emits. Each
  // field is read as a string or dropped; the service validates every value
  // against the period's own options after that.
  const raw = (input ?? {}) as Record<string, unknown>;
  const asString = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

  const request: TimesheetChatFactsRequest = {
    granularity: asString(raw.granularity),
    start: asString(raw.start),
    person: asString(raw.person),
    client: asString(raw.client),
    project: asString(raw.project),
    category: asString(raw.category),
    billable: asString(raw.billable),
  };

  try {
    return await getTimesheetChatFactsService(request);
  } catch (error) {
    console.error("runChatTool: timesheet lookup failed", error);
    return { error: "The timesheet figures could not be read just now." };
  }
}
