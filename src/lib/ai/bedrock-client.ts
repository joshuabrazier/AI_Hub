import "server-only";

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

import { envServer } from "@/lib/env-server";

// -------------------------------------------------------------------
// Amazon Bedrock client - the one place the model is reached from.
//
// WHY THE AWS SDK AND NOT THE ANTHROPIC BEDROCK SDK
//
// @anthropic-ai/bedrock-sdk documents only SigV4 credentials
// (accessKeyId / secretAccessKey / sessionToken). Our key is a Bedrock API
// KEY - a bearer token - and bearer auth is not part of that SDK's
// documented surface. @aws-sdk/client-bedrock-runtime reads the token
// natively (see AUTHENTICATION below) and is the direct analogue of the
// boto3 `converse` call our provisioning doc is written against, so the
// same doc keeps describing this code.
//
// It is also the API that accepts a cross-region inference profile id like
// the one below; the Anthropic SDK's Messages-API Bedrock endpoint expects
// `anthropic.`-prefixed model ids on a different host, which this key's IAM
// policy does not cover.
//
// -------------------------------------------------------------------
// DATA RESIDENCY - THE POINT OF THIS FILE
//
// The key is region-locked to Australia and scoped to one model. Both
// constants below are PINNED and deliberately not read from the
// environment: making them configurable is exactly how a deploy ends up
// pointing at another region, and the residency guarantee is the reason
// this key exists.
//
//   - `au.` is a cross-region inference profile that routes only within
//     Australian regions. `global.` and `us.` profiles route offshore and
//     are denied by the key's IAM policy. Do not "fix" a throttling or
//     availability problem by switching prefix - that breaks residency, and
//     it would fail anyway.
//   - The model id carries no date stamp and no `:0` suffix. That is
//     specific to this model; other models differ. Do not add one.
//
// Needing Melbourne (ap-southeast-4) as a direct entry point is an IAM
// change for whoever provisioned the key, not a code change here.
// -------------------------------------------------------------------
export const BEDROCK_REGION = "ap-southeast-2";
export const BEDROCK_MODEL_ID = "au.anthropic.claude-opus-4-6-v1";

// How long one model response may take before the request is abandoned.
// Generous because a long answer legitimately takes a while, and the reply
// is streamed so the reader sees progress throughout.
const READ_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 10_000;

// -------------------------------------------------------------------
// AUTHENTICATION
//
// The SDK resolves the bearer token itself: its Bedrock auth scheme calls
// `fromEnvSigningName({ signingName: "bedrock" })`, which reads
// AWS_BEARER_TOKEN_BEDROCK from the environment and signs with
// HttpBearerAuthSigner. Nothing is passed in here, and the token is never
// read into a variable, logged, or sent to the browser.
//
// `authSchemePreference` pins that choice. Without it the client would
// prefer SigV4 whenever AWS_ACCESS_KEY_ID happens to be present in the
// environment - on a CI runner or an EC2 instance with a role, for example -
// and would then authenticate as something other than this key, with
// different permissions and no residency guarantee. Failing outright is
// better than silently using the wrong identity.
// -------------------------------------------------------------------
let cachedClient: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
  if (cachedClient) return cachedClient;

  if (!envServer.AWS_BEARER_TOKEN_BEDROCK) {
    throw new Error("AWS_BEARER_TOKEN_BEDROCK is not set");
  }

  cachedClient = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    authSchemePreference: ["httpBearerAuth"],
    requestHandler: {
      requestTimeout: READ_TIMEOUT_MS,
      connectionTimeout: CONNECT_TIMEOUT_MS,
    },
    // Adaptive retries back off with jitter on throttling and transient
    // 5xx. AccessDenied and ValidationException are not retried by design:
    // the first means the key is wrong, revoked, or pointed at the wrong
    // region, and the second means the request is malformed. Retrying
    // either just burns time.
    maxAttempts: 5,
    retryMode: "adaptive",
  });

  return cachedClient;
}

// -------------------------------------------------------------------
// Whether chat is usable at all. The feature is optional: with no token
// configured the routes answer 503 and say so, rather than throwing on
// import and taking the whole app down with them.
// -------------------------------------------------------------------
export function isBedrockConfigured(): boolean {
  return Boolean(envServer.AWS_BEARER_TOKEN_BEDROCK);
}
