// -------------------------------------------------------------------
// Check the Bedrock connection
//
// Sends one tiny message to the model and prints the reply plus token usage.
// Use it to confirm a key works before blaming the app, and to tell a rotated
// or revoked key apart from a code fault - the two look identical from the UI.
//
// Read-only: it writes nothing to the database and creates no conversation.
//
// Run:  node --env-file=.env scripts/check-bedrock.mjs
//
// NOTE: the region and model below are duplicated from
// src/lib/ai/bedrock-client.ts because this is a plain .mjs script and cannot
// import the TypeScript module. They must stay in sync - if you change one,
// change both. The app's copy is the authority.
// -------------------------------------------------------------------
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const REGION = "ap-southeast-2";
const MODEL_ID = "au.anthropic.claude-opus-4-6-v1";

if (!process.env.AWS_BEARER_TOKEN_BEDROCK) {
  console.error("\nAWS_BEARER_TOKEN_BEDROCK is not set.\n");
  console.error("  Add it to .env, then re-run:");
  console.error("    node --env-file=.env scripts/check-bedrock.mjs\n");
  console.error("  Or for one shell only (PowerShell):");
  console.error('    $env:AWS_BEARER_TOKEN_BEDROCK = "your-key"\n');
  process.exit(1);
}

// authSchemePreference pins bearer auth. Without it the client prefers SigV4
// whenever AWS_ACCESS_KEY_ID happens to be in the environment, which would
// authenticate as something other than this key.
const client = new BedrockRuntimeClient({
  region: REGION,
  authSchemePreference: ["httpBearerAuth"],
});

console.log(`\nregion:  ${REGION}`);
console.log(`model:   ${MODEL_ID}`);
console.log(`token:   set (${process.env.AWS_BEARER_TOKEN_BEDROCK.length} chars, value not printed)`);
console.log("\nsending one message...\n");

try {
  const response = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: "Answer in one short sentence." }],
      messages: [{ role: "user", content: [{ text: "In one sentence, confirm you are reachable." }] }],
      inferenceConfig: { maxTokens: 100 },
    }),
  );

  const text = response.output?.message?.content?.[0]?.text ?? "(no text in response)";

  console.log(`reply:       ${text}`);
  console.log(`stopReason:  ${response.stopReason}`);
  console.log(
    `tokens:      ${response.usage?.inputTokens} in / ${response.usage?.outputTokens} out ` +
      `(${response.usage?.totalTokens} total)`,
  );
  console.log(`latency:     ${response.metrics?.latencyMs}ms`);
  console.log("\nBedrock is reachable and the key works.\n");
} catch (error) {
  const code = error?.name ?? "UnknownError";
  console.error(`\nFAILED: ${code}`);
  console.error(`${error?.message ?? error}\n`);

  // The three failures worth telling apart, because the fix differs entirely.
  if (code.startsWith("AccessDenied")) {
    console.error("  The key was rejected. Usually one of:");
    console.error("    - the key has expired or was revoked in the Bedrock console");
    console.error(`    - the key's IAM policy does not allow ${REGION}`);
    console.error(`    - the key is not scoped to ${MODEL_ID}`);
    console.error("    - AWS credentials in the environment took precedence (unset AWS_ACCESS_KEY_ID)");
  } else if (code.startsWith("Validation")) {
    console.error("  The request was malformed - almost always the model id.");
    console.error("  This model takes no date stamp and no ':0' suffix, and the 'au.' prefix");
    console.error("  is required: 'global.' and 'us.' profiles route offshore and are denied.");
  } else if (code.startsWith("Throttling")) {
    console.error("  Rate or quota limit. The app retries these with backoff; this script does not.");
    console.error("  Request an increase in the AWS Service Quotas console for Bedrock.");
  }

  console.error("");
  process.exit(1);
}
