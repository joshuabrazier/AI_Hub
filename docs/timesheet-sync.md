# Timesheet sync

How Jira time gets into this app, and the rules that keep the numbers
trustworthy enough to invoice from.

## The shape of it

Jira is the source of truth for time. This app holds a **read model** derived
from it: worklog facts, the issues behind them, and the audit findings over the
two. Nothing here is the only copy of anything, which means the whole read model
can be dropped and rebuilt from Jira at any point. That property is what makes
it safe to change.

```text
Jira  ->  sync job  ->  worklog_fact / jira_issue  ->  aggregation engine  ->  reports
```

The app never writes to Jira. A fix goes into Jira and arrives here on the next
sync.

## Setting it up

1. Apply the migration:

   ```bash
   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/001_timesheet_read_model.sql
   ```

2. Create a **dedicated Atlassian service account** and an API token for it. It
   needs Browse Projects on every space plus the time tracking permissions, and
   nothing more - the sync never writes.

   This must not be a person's own token. When that account is deactivated the
   sync stops, and billing stops with it, with nothing visibly breaking.

3. Find the custom field ids at `{JIRA_BASE_URL}/rest/api/3/field`. Jira exposes
   custom fields by id, not name, and the ids differ per site.

4. Fill in the `JIRA_*` block in `.env` (see `.env.example`). In a deployed
   environment the token and the sync secret live in Key Vault, referenced by
   App Service settings.

5. Point a timer at the endpoint - a Logic App or an Azure Function, the same
   shape as the existing email queue timer:

   ```http
   POST /api/jobs/jira-sync
   Authorization: Bearer $JIRA_SYNC_SECRET
   ```

6. Leave `JIRA_SYNC_ENABLED=false` for the first runs. The job reads Jira and
   reports what it *would* write, changing nothing. Set it to `true` once a dry
   run looks right.

## Why the job is built the way it is

### The watermark advances last

The order is: read the watermark, read what changed, write it, **then** advance
the watermark - all in one transaction.

If the job dies anywhere before that last step, the transaction rolls back and
the next run repeats the same window. Repeating is free, because every write is
an upsert keyed on Jira's own worklog id. Skipping is not: it loses billable
time, and nothing downstream would ever report it missing.

Each run also re-reads `JIRA_SYNC_OVERLAP_MINUTES` before the watermark, to
cover clock skew between this app and Jira. Overlap is free; gaps are not.

### Keyed on Jira's worklog id

`worklog_fact.worklog_id` is Jira's id, and it is the primary key. This is the
single most important line of defence against double-counting, and therefore
against over-invoicing.

It is also the test that decides whether phase 1 is done: **run the job twice
and the totals must not move.** If a second run changes any number, the sync is
not idempotent and nothing built on top of it can be trusted.

### Everything is an integer

There is no `NUMERIC` column in the read model, on purpose.

node-postgres returns `NUMERIC` and `BIGINT` as JavaScript **strings**, to avoid
losing precision. Nothing warns you: `total + row.hours` then concatenates
instead of adding, and `"7.5" + "2.5"` is `"7.52.5"`. On a page that decides an
invoice, that is not a bug to be one type parser away from.

So durations are whole seconds, clock positions are seconds past midnight, and
hours are derived for display. Sums are exact, with no floating point drift.

### Dates are Adelaide-local strings

`work_date` is a `DATE`, parsed to a `'YYYY-MM-DD'` string, in the app timezone.

A 9am Adelaide entry is 23:30 the previous day in UTC. Anything that reads the
date off a UTC timestamp is wrong for part of every day, and wrong differently
either side of the October daylight saving change. The conversion is explicit,
in `toAppZoneDate`, and tested on both sides of that change.

Compare these dates as strings. Never parse one to a `Date` to compare it.

### accountId, never the display name

People change surnames. `person_id` is the Atlassian accountId, and every
grouping is on it. `person_name` is a label carried alongside for display, and
nothing joins or groups on it.

## The aggregation engine

`src/lib/timesheet/aggregate.ts` takes a snapshot object and returns a report.
No dependencies, no I/O, and no clock - today's date is passed in.

That purity is the point: the same code runs in the sync job, behind the API and
in the tests, so the three cannot disagree about what a month is worth. It also
means the engine can be exercised without a database.

`aggregate.test.ts` recomputes every figure from hand-worked literals rather
than by calling the engine back on itself. A test that checks the engine against
itself passes just as happily when both sides are wrong.

## The audit

Ten rules, in `audit-rules.ts`. Severity decides money:

| Code | Severity | What it means |
|---|---|---|
| `WORKLOG_OVERLAP` | blocking | One person booked to two items over the same clock time |
| `ORPHAN_WORKLOG` | blocking | The issue is missing, so the time cannot be attributed |
| `BILLABLE_UNSET` | blocking | Neither the item nor its parent says whether it bills |
| `NON_POSITIVE_DURATION` | blocking | An entry of zero or negative length |
| `FUTURE_DATED` | blocking | Work booked to a day that has not happened |
| `BILLABLE_INHERITED` | warning | Status comes from the parent, so re-parenting changes it silently |
| `MISSING_NARRATIVE` | warning | No work description, so the line cannot be itemised |
| `NO_PARENT_ITEM` | warning | Time rolls up to no deliverable |
| `EXCESSIVE_DAY` | warning | More hours in a day than a person plausibly worked |
| `BUDGET_EXCEEDED` | warning | Actuals past the current estimate |

A **blocking** finding means `isBillable` is false and the period does not get
invoiced until it is fixed in Jira and re-synced. A **warning** means somebody
should look, but the numbers are usable.

Rules report; they never repair. A rule that quietly corrected a worklog would
hide the thing the person needs to fix, and the read model would stop matching
its source.

`MISSING_NARRATIVE` is a warning rather than a blocker deliberately: today most
entries have no description, so blocking would mark every period non-billable
and the state would carry no information at all. Revisit once narrative
drafting is in and a described entry is the normal case.

## Open items

### The worklog endpoint contract is unconfirmed

`jira-client.ts` uses three endpoints:

- `GET /rest/api/3/worklog/updated?since={epochMillis}`
- `POST /rest/api/3/worklog/list`
- `GET /rest/api/3/worklog/deleted?since={epochMillis}`

The paths, the 1000-id batch cap and the pagination field names (`values`,
`nextPage`, `lastPage`) come from a third-party guide, **not** from Atlassian's
own reference. That page renders as client-side navigation and could not be
read, on two separate attempts.

**Confirm all three against the [official reference](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/)
before the first production run.** If any of it is wrong, `jira-client.ts` is
the only file that changes.

Until then the mitigation is in the code: every response is shape-checked and a
mismatch throws by name. It must never be possible for a wrong guess to read as
"nothing changed" - that failure would look exactly like a quiet week and would
stop billing without a single error in the log.

### Estimates

Jira's `timeoriginalestimate` is the original estimate; `timeestimate` is the
**remaining** estimate, not a revised total. Treating remaining as "current"
would make a nearly finished item look nearly unbudgeted, so it is not used.
Current falls back to the original unless `JIRA_FIELD_BASELINE_ESTIMATE` says
otherwise.

Confirm this against how the team actually uses those fields before any budget
report goes to a client.

### Authentication

Basic auth with a service account API token. Atlassian call this "not as secure
as other methods" and recommend OAuth 2.0 3LO for apps - but 3LO is built around
a person clicking Allow in a browser, and a timer job at 3am has nobody to click
it. The service account is the deliberate choice; revisit if Atlassian change
the deprecation position.
