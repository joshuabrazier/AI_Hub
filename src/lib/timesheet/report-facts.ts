import type { SummaryFacts, SummaryPersonFacts } from "./summary-facts";

// -------------------------------------------------------------------
// The facts a REPORT is written from.
//
// A superset of the summary's, and its own type rather than more optional
// fields on SummaryFacts. A report has sections a summary does not - job
// budget health and outstanding data-quality findings - and bolting them on
// as nullable members would leave every summary scope carrying three empty
// arrays and every reader wondering which scopes fill them.
//
// The same rule governs both: THE MODEL NEVER COMPUTES A NUMBER. Everything
// here is copied from what the timesheet engine already derived. See the note
// in summary-facts.ts.
//
// NO FINGERPRINT HERE, and that is the real difference. A summary is a cache
// and needs to know when the figures have moved. A report is a record of what
// they were, so it snapshots them instead: the facts are stored beside the
// prose as its evidence, and nothing later marks them wrong.
// -------------------------------------------------------------------

export interface ReportBudgetFacts {
  job: string;
  category: string | null;
  // What the job is estimated at now, and what has actually been booked.
  estimateHours: number | null;
  actualHours: number | null;
  // actual - estimate. Positive is over. Null when there is no estimate to be
  // over, which is a different and more interesting problem.
  varianceHours: number | null;
  consumedPercent: number | null;
}

export interface ReportFindingFacts {
  code: string;
  severity: string;
  // The engine's own plain-language statement, with no advice in it. Passed
  // through rather than paraphrased here: the model may reword it, but the
  // authoritative sentence is the one the rule wrote.
  message: string;
  personName: string | null;
  workDate: string | null;
  issueKey: string | null;
}

export interface ReportFacts {
  periodLabel: string;
  granularity: string;
  weekdaysInPeriod: number | null;
  filters: { category: string; project: string; person: string };
  // Business totals, the category split, the biggest jobs and invoice
  // readiness - the overview screen's figures.
  business: SummaryFacts["totals"];
  categories: SummaryFacts["categories"];
  topJobs: SummaryFacts["topJobs"];
  readiness: SummaryFacts["readiness"];
  // Everybody, measured against their own contracted capacity.
  people: SummaryPersonFacts[];
  // How many people there are in total, which is not people.length once the
  // list is capped.
  peopleCount: number;
  // The book of work: what is over, what is unestimated, what is untouched.
  budget: ReportBudgetFacts[];
  jobsCount: number;
  // What still needs fixing in Jira before the period is invoiced.
  findings: ReportFindingFacts[];
  findingsCount: number;
  blockingCount: number;
  warningCount: number;
  // False when any finding is blocking. The engine's own verdict, carried
  // through so the report cannot reach a cheerier conclusion than the data.
  isBillable: boolean;
}
