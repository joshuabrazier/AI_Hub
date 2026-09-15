// ---------------------------------------------------------------
// One Bedrock call, timed by STAGE. Throwaway diagnostic.
//
// Answers the question the production logs cannot: when a call produces
// nothing, did the request reach Bedrock at all?
//
//   headers   send() settling means AWS acknowledged the request. It cannot
//             settle for one that never got there.
//   first     the first stream event after that.
//
// Same key, same region and same model as the deployed app, run from a
// different network. If this succeeds while Azure is failing, the key and
// the service are fine and the fault is in the Azure environment.
// ---------------------------------------------------------------
import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = "au.anthropic.claude-opus-4-6-v1";
const REGION = "ap-southeast-2";
const CEILING_MS = 60_000;

if (!process.env.AWS_BEARER_TOKEN_BEDROCK) {
  console.error("AWS_BEARER_TOKEN_BEDROCK is not set - run with: node --env-file=.env scripts/bedrock-probe.mjs");
  process.exit(1);
}

const client = new BedrockRuntimeClient({
  region: REGION,
  authSchemePreference: ["httpBearerAuth"],
});

const started = Date.now();
const since = () => `${Date.now() - started}ms`;

const timeout = AbortSignal.timeout(CEILING_MS);

console.log(`probing ${MODEL_ID} in ${REGION}, ceiling ${CEILING_MS / 1000}s`);

try {
  const response = await client.send(
    new ConverseStreamCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: "Reply with the single word: ok" }] }],
      inferenceConfig: { maxTokens: 16, temperature: 0 },
    }),
    { abortSignal: timeout },
  );

  console.log(`  headers  ${since()}   <- the request REACHED Bedrock`);

  if (!response.stream) {
    console.log("  stream   none returned");
    process.exit(2);
  }

  let first = null;
  let text = "";
  let usage = null;

  for await (const event of response.stream) {
    if (first === null) {
      first = Date.now();
      console.log(`  first    ${since()}   <- first stream event`);
    }

    const chunk = event.contentBlockDelta?.delta?.text;
    if (chunk) text += chunk;
    if (event.metadata?.usage) usage = event.metadata.usage;
  }

  console.log(`  done     ${since()}`);
  console.log(`  reply    ${JSON.stringify(text.trim())}`);
  console.log(`  tokens   in ${usage?.inputTokens ?? "-"} / out ${usage?.outputTokens ?? "-"}`);
  console.log("\nRESULT: Bedrock answered normally from this machine.");
} catch (error) {
  const reached = error?.$metadata?.httpStatusCode !== undefined;

  console.log(`  failed   ${since()}`);
  console.log(`  name     ${error?.name}`);
  console.log(`  message  ${error?.message}`);
  console.log(`  attempts ${error?.$metadata?.attempts ?? "-"}`);
  console.log(`  status   ${error?.$metadata?.httpStatusCode ?? "none - no response was received"}`);

  console.log(
    reached
      ? "\nRESULT: Bedrock responded, and the failure is in what came back."
      : "\nRESULT: no response was ever received from Bedrock from this machine either.",
  );
  process.exit(1);
}
