import { WorklogFactRow } from "./timesheet.types";

// -------------------------------------------------------------------
// Company overview: the shapes worth seeing in a book of timesheets.
//
// Pure, like the rest of the engine. Facts in, series out, no clock and no
// I/O - the anchor week is passed in rather than read from the machine.
//
// Four questions this answers, chosen because they are the ones a director
// actually asks and the raw entry list cannot show:
//
//   1. Where is the time going - client work or our own overheads?
//   2. Which jobs are consuming it?
//   3. How much of it is not yet in a state we could invoice?
//
// The day-by-day shape of a week is answered by the weekly chart, which reads
// the same facts through daily-series.ts.
// -------------------------------------------------------------------

const SECONDS_PER_HOUR = 3600;

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toHours(seconds: number): number {
  return round(seconds / SECONDS_PER_HOUR);
}

// -------------------------------------------------------------------
// Where the time went, by category (Internal vs External) and by job.
// -------------------------------------------------------------------
export interface SplitSlice {
  key: string;
  label: string;
  hours: number;
  billableHours: number;
  nonBillableHours: number;
  unsetHours: number;
  // Share of the whole, 0-1.
  share: number;
}

export function buildCategorySplit(facts: WorklogFactRow[]): SplitSlice[] {
  const byCategory = new Map<string, { total: number; billable: number; nonBillable: number; unset: number }>();

  for (const fact of facts) {
    const key = fact.category ?? "Uncategorised";
    const bucket = byCategory.get(key) ?? { total: 0, billable: 0, nonBillable: 0, unset: 0 };

    bucket.total += fact.timeSpentSeconds;
    if (fact.billable === "Billable") bucket.billable += fact.timeSpentSeconds;
    else if (fact.billable === "Non-billable") bucket.nonBillable += fact.timeSpentSeconds;
    else bucket.unset += fact.timeSpentSeconds;

    byCategory.set(key, bucket);
  }

  const grandTotal = [...byCategory.values()].reduce((total, bucket) => total + bucket.total, 0);

  return [...byCategory.entries()]
    .map(([key, bucket]) => ({
      key,
      label: key,
      hours: toHours(bucket.total),
      billableHours: toHours(bucket.billable),
      nonBillableHours: toHours(bucket.nonBillable),
      unsetHours: toHours(bucket.unset),
      share: grandTotal > 0 ? round(bucket.total / grandTotal) : 0,
    }))
    .sort((left, right) => right.hours - left.hours || left.key.localeCompare(right.key));
}

export interface JobSlice extends SplitSlice {
  parentKey: string | null;
  category: string | null;
  peopleCount: number;
}

// -------------------------------------------------------------------
// The jobs consuming the most time, largest first.
//
// `limit` caps the list, and anything past it is folded into a single "Other"
// row rather than dropped. A chart that silently truncates reads as though it
// showed everything, and the totals then do not add up to the headline figure.
// -------------------------------------------------------------------
export function buildTopJobs(facts: WorklogFactRow[], summaryByKey: Map<string, string>, limit = 8): JobSlice[] {
  interface Bucket {
    seconds: number;
    billable: number;
    nonBillable: number;
    unset: number;
    category: string | null;
    people: Set<string>;
  }

  const byJob = new Map<string, Bucket>();

  for (const fact of facts) {
    const key = fact.parentKey ?? "";
    const bucket: Bucket = byJob.get(key) ?? {
      seconds: 0,
      billable: 0,
      nonBillable: 0,
      unset: 0,
      category: fact.category,
      people: new Set<string>(),
    };

    bucket.seconds += fact.timeSpentSeconds;
    if (fact.billable === "Billable") bucket.billable += fact.timeSpentSeconds;
    else if (fact.billable === "Non-billable") bucket.nonBillable += fact.timeSpentSeconds;
    else bucket.unset += fact.timeSpentSeconds;
    bucket.people.add(fact.personId);

    byJob.set(key, bucket);
  }

  const grandTotal = [...byJob.values()].reduce((total, bucket) => total + bucket.seconds, 0);

  const ranked = [...byJob.entries()].sort(
    ([leftKey, left], [rightKey, right]) => right.seconds - left.seconds || leftKey.localeCompare(rightKey),
  );

  const toSlice = ([key, bucket]: [string, Bucket]): JobSlice => ({
    key: key || "none",
    parentKey: key || null,
    label: key ? (summaryByKey.get(key) ?? key) : "No job",
    category: bucket.category,
    hours: toHours(bucket.seconds),
    billableHours: toHours(bucket.billable),
    nonBillableHours: toHours(bucket.nonBillable),
    unsetHours: toHours(bucket.unset),
    share: grandTotal > 0 ? round(bucket.seconds / grandTotal) : 0,
    peopleCount: bucket.people.size,
  });

  if (ranked.length <= limit) return ranked.map(toSlice);

  const head = ranked.slice(0, limit).map(toSlice);
  const tail = ranked.slice(limit);

  // The tail is folded into one row rather than dropped. A chart that silently
  // truncates reads as though it showed everything, and its bars then do not
  // add up to the headline figure.
  const tailSeconds = tail.reduce((total, [, bucket]) => total + bucket.seconds, 0);
  const tailPeople = new Set<string>();
  for (const [, bucket] of tail) for (const person of bucket.people) tailPeople.add(person);

  const other: JobSlice = {
    key: "other",
    parentKey: null,
    label: `${tail.length} other ${tail.length === 1 ? "job" : "jobs"}`,
    category: null,
    hours: toHours(tailSeconds),
    billableHours: toHours(tail.reduce((total, [, bucket]) => total + bucket.billable, 0)),
    nonBillableHours: toHours(tail.reduce((total, [, bucket]) => total + bucket.nonBillable, 0)),
    unsetHours: toHours(tail.reduce((total, [, bucket]) => total + bucket.unset, 0)),
    share: grandTotal > 0 ? round(tailSeconds / grandTotal) : 0,
    peopleCount: tailPeople.size,
  };

  return [...head, other];
}

// -------------------------------------------------------------------
// How much of the period is not yet in a state anybody could invoice.
//
// Kept as hours rather than a count of entries: "nine entries need a
// description" is easy to shrug at, "seven hours cannot be itemised" is not.
// -------------------------------------------------------------------
export interface InvoiceReadiness {
  loggedHours: number;
  billableHours: number;
  // Billable time that has no work description, so it cannot be itemised.
  undescribedBillableHours: number;
  // Time whose billable status nobody has set.
  unsetHours: number;
  // Billable, described, and therefore ready to appear on an invoice.
  readyHours: number;
  readyShare: number | null;
}

export function buildInvoiceReadiness(facts: WorklogFactRow[]): InvoiceReadiness {
  let logged = 0;
  let billable = 0;
  let undescribedBillable = 0;
  let unset = 0;

  for (const fact of facts) {
    logged += fact.timeSpentSeconds;

    if (fact.billable === "Billable") {
      billable += fact.timeSpentSeconds;
      if (!fact.hasNarrative) undescribedBillable += fact.timeSpentSeconds;
    } else if (fact.billable !== "Non-billable") {
      unset += fact.timeSpentSeconds;
    }
  }

  const ready = billable - undescribedBillable;

  return {
    loggedHours: toHours(logged),
    billableHours: toHours(billable),
    undescribedBillableHours: toHours(undescribedBillable),
    unsetHours: toHours(unset),
    readyHours: toHours(ready),
    readyShare: billable > 0 ? round(ready / billable) : null,
  };
}
