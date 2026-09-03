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

// The SAME rule the sync applies, imported rather than restated. It used to
// be duplicated here with a comment asking whoever changed one to change the
// other, and the first change after that comment updated the sync only. A
// backfill classifying hours by a different rule from the sync is a quiet,
// systematic wrong answer in a tax claim.
import { classifyRnd } from "../src/lib/timesheet/rnd-rule.mjs";

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

// Read from the environment exactly as the sync does, so a backfill and a
// sync run minutes apart cannot disagree about which spaces are core. Unset
// means labels only.
const coreProjectKeys = (process.env.RND_CORE_PROJECT_KEYS ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter((key) => key.length > 0);

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

      // The project key comes from the issue key rather than fields.project,
      // because the key is what the worklog rows are matched on and the two
      // must not be able to disagree.
      const projectKey = typeof issue.key === "string" ? issue.key.split("-")[0] : null;

      const { rndClass, rndSource, hasBothLabels } = classifyRnd(labels, { projectKey, coreProjectKeys });
      if (hasBothLabels) bothLabels.push(issue.key);

      classifications.set(issue.key, { labels, rndClass, rndSource });
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

  const summary = { core: 0, supporting: 0, none: 0, bySpace: 0 };
  for (const { rndClass, rndSource } of classifications.values()) {
    if (rndClass === "core") summary.core += 1;
    else if (rndClass === "supporting") summary.supporting += 1;
    else summary.none += 1;
    if (rndSource === "space") summary.bySpace += 1;
  }

  console.log("");
  console.log(`  issues classified core:       ${summary.core}`);
  console.log(`  issues classified supporting: ${summary.supporting}`);
  console.log(`  issues classified by neither: ${summary.none}`);
  if (coreProjectKeys.length > 0) {
    console.log("");
    console.log(`  core spaces: ${coreProjectKeys.join(", ")}`);
    // Reported apart from the labelled ones on purpose. "The item carried
    // this label" is materially stronger evidence than "our config treats
    // that project as R&D", and a total that merged them would hide how much
    // of a claim rests on the weaker of the two.
    console.log(`  of the above, ${summary.bySpace} issue(s) are core because of their SPACE, not a label.`);
  }
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

  for (const [issueKey, { labels, rndClass, rndSource }] of classifications) {
    const result = await client.query(
      `UPDATE worklog_fact
          SET labels_snapshot = $2, rnd_class = $3, rnd_source = $4, classified_at = $5
        WHERE issue_key = $1 AND classified_at IS NULL`,
      [issueKey, labels.length > 0 ? labels.join(",") : null, rndClass, rndSource, classifiedAt],
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
