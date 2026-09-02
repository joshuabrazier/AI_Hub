// -------------------------------------------------------------------
// Backfill R&D classification onto worklogs that predate it.
//
// ===================================================================
// READ THIS BEFORE RUNNING IT, AND SAY IT OUT LOUD WHEN REPORTING THE
// NUMBERS IT PRODUCES
// ===================================================================
// A backfill assigns TODAY'S labels to HISTORICAL worklogs. That is
// unavoidable - Jira keeps no label history, so today's labels are the only
// ones there are - but it is NOT the same thing as a contemporaneous
// classification.
//
// Everything the sync classifies from now on is frozen at the moment the
// work was synced. Everything this script touches is frozen at the moment
// this script ran. If a claim is ever questioned, that distinction is the
// first thing to be able to state, so the script prints it, and every row
// it writes carries classified_at set to the run time rather than to the
// work date.
//
// It is also why this is a ONE-OFF and not a scheduled job. Re-running it
// would move classifications that the sync has since made properly.
//
// Run:
//   $env:DATABASE_URL = "..."
//   $env:JIRA_BASE_URL = "..."; $env:JIRA_EMAIL = "..."; $env:JIRA_API_TOKEN = "..."
//   node scripts/backfill-rnd-classification.mjs            report only
//   node scripts/backfill-rnd-classification.mjs --apply    write it
//
// Off-hours, please. The site is on the Jira Free plan and this walks every
// distinct issue that has a worklog against it.
// -------------------------------------------------------------------
import pg from "pg";

const RND_CORE_LABEL = "RnD-core";
const RND_SUPPORTING_LABEL = "RnD-supporting";

// Jira's cap for POST /rest/api/3/issue/bulkfetch.
const BULK_BATCH_SIZE = 100;

// Free plan. A pause between batches costs minutes on a one-off run and
// avoids being the reason somebody's Jira is slow.
const PAUSE_BETWEEN_BATCHES_MS = 1000;

const MAX_RETRIES = 5;

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.JIRA_BASE_URL;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_API_TOKEN;

const apply = process.argv.includes("--apply");

for (const [name, value] of Object.entries({ DATABASE_URL: databaseUrl, JIRA_BASE_URL: baseUrl, JIRA_EMAIL: email, JIRA_API_TOKEN: token })) {
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
}

const auth = Buffer.from(`${email}:${token}`).toString("base64");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -------------------------------------------------------------------
// One bulkfetch, with the retry the Free plan makes necessary.
//
// Honours Retry-After when Jira sends one. A backfill that gave up on the
// first 429 would leave the table half classified, which is worse than not
// starting: some rows frozen, some not, and no way to tell which from the
// data alone.
// -------------------------------------------------------------------
async function bulkfetch(issueKeys) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/api/3/issue/bulkfetch`, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ issueIdsOrKeys: issueKeys, fields: ["labels", "summary", "project"] }),
    });

    if (response.ok) return await response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES - 1) {
      throw new Error(`Jira bulkfetch answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
    console.log(`  ${response.status} from Jira, waiting ${seconds}s`);
    await wait(seconds * 1000);
  }

  throw new Error("unreachable");
}

// The same rule as classifyRnd in jira-mapping.ts. Duplicated here because a
// .mjs script cannot import the TypeScript module - so if that rule ever
// changes, change it in BOTH places. The unit tests cover the real one.
function classify(labels) {
  const hasCore = labels.includes(RND_CORE_LABEL);
  const hasSupporting = labels.includes(RND_SUPPORTING_LABEL);

  if (hasCore && hasSupporting) return { rndClass: "core", both: true };
  if (hasCore) return { rndClass: "core", both: false };
  if (hasSupporting) return { rndClass: "supporting", both: false };
  return { rndClass: null, both: false };
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  // Only rows that have never been classified. A row the sync has already
  // frozen properly must not be overwritten with today's labels.
  const { rows: pending } = await client.query(
    `SELECT DISTINCT issue_key FROM worklog_fact WHERE classified_at IS NULL ORDER BY issue_key`,
  );

  const { rows: [counts] } = await client.query(
    `SELECT count(*) FILTER (WHERE classified_at IS NULL) AS unclassified,
            count(*) AS total
     FROM worklog_fact`,
  );

  console.log("");
  console.log(`  ${counts.total} worklog(s) stored, ${counts.unclassified} never classified.`);
  console.log(`  ${pending.length} distinct issue(s) to look up.`);
  console.log("");

  if (pending.length === 0) {
    console.log("  Nothing to do.\n");
    process.exit(0);
  }

  const issueKeys = pending.map((row) => row.issue_key);
  const classifications = new Map();
  const bothLabels = [];
  const notFound = [];

  for (let start = 0; start < issueKeys.length; start += BULK_BATCH_SIZE) {
    const batch = issueKeys.slice(start, start + BULK_BATCH_SIZE);
    const batchNumber = Math.floor(start / BULK_BATCH_SIZE) + 1;
    const batchCount = Math.ceil(issueKeys.length / BULK_BATCH_SIZE);

    process.stdout.write(`  batch ${batchNumber}/${batchCount} (${batch.length} issues) ... `);

    const payload = await bulkfetch(batch);
    const issues = Array.isArray(payload?.issues) ? payload.issues : [];

    for (const issue of issues) {
      const labels = Array.isArray(issue?.fields?.labels)
        ? issue.fields.labels.filter((label) => typeof label === "string" && label.trim().length > 0)
        : [];

      const { rndClass, both } = classify(labels);
      if (both) bothLabels.push(issue.key);

      classifications.set(issue.key, { labels, rndClass });
    }

    // An issue deleted in Jira since its worklogs were synced. Its hours stay
    // in the table; they simply cannot be classified from a thing that is
    // gone. Reported rather than guessed at.
    for (const key of batch) {
      if (!classifications.has(key)) notFound.push(key);
    }

    console.log(`${issues.length} returned`);

    if (start + BULK_BATCH_SIZE < issueKeys.length) await wait(PAUSE_BETWEEN_BATCHES_MS);
  }

  const summary = { core: 0, supporting: 0, none: 0 };
  for (const { rndClass } of classifications.values()) {
    if (rndClass === "core") summary.core += 1;
    else if (rndClass === "supporting") summary.supporting += 1;
    else summary.none += 1;
  }

  console.log("");
  console.log(`  issues classified core:       ${summary.core}`);
  console.log(`  issues classified supporting: ${summary.supporting}`);
  console.log(`  issues with neither label:    ${summary.none}`);
  if (notFound.length) console.log(`  issues not found in Jira:     ${notFound.length}`);
  if (bothLabels.length) {
    console.log("");
    console.log(`  WARNING: ${bothLabels.length} issue(s) carry BOTH labels and were resolved to core.`);
    console.log(`  Fix these in Jira: ${bothLabels.join(", ")}`);
  }
  console.log("");

  if (!apply) {
    console.log("  Report only - nothing was written. Re-run with --apply.\n");
    process.exit(0);
  }

  const classifiedAt = new Date();
  let rowsWritten = 0;

  for (const [issueKey, { labels, rndClass }] of classifications) {
    const result = await client.query(
      `UPDATE worklog_fact
          SET labels_snapshot = $2, rnd_class = $3, classified_at = $4
        WHERE issue_key = $1 AND classified_at IS NULL`,
      [issueKey, labels.length > 0 ? labels.join(",") : null, rndClass, classifiedAt],
    );
    rowsWritten += result.rowCount ?? 0;
  }

  console.log(`  ${rowsWritten} worklog row(s) classified.`);
  console.log("");
  console.log("  NOTE FOR THE RECORD: these rows were assigned TODAY'S labels.");
  console.log("  Jira keeps no label history, so this is the only classification");
  console.log("  available for them - but it is NOT a contemporaneous one, and it");
  console.log("  should not be presented as though the labels were checked at the");
  console.log("  time the work was done. Everything the sync classifies from here");
  console.log("  on IS contemporaneous.");
  console.log("");
} finally {
  await client.end();
}
