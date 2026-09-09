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

// ===================================================================
// TIMEOUTS, AND THE OPTION THAT DOES NOT DO WHAT ITS NAME SAYS
//
// THIS BLOCK IS A CORRECTION. It previously set `requestTimeout` and
// explained at length how the SDK would therefore give up first and throw
// something with a name, leaving our own stall guard as a backstop that
// rarely fired. Every word of that was wrong, and it is why chat failures
// were unreadable for weeks.
//
// In @smithy/node-http-handler, from its own type documentation:
//
//   requestTimeout          "The maximum number of milliseconds request &
//                           response should take. If exceeded, A WARNING
//                           WILL BE EMITTED unless throwOnRequestTimeout=
//                           true, in which case a TimeoutError will be
//                           thrown."
//
//   throwOnRequestTimeout   "Because requestTimeout was for a long time
//                           incorrectly being set as a socket idle timeout,
//                           users must also opt-in for request timeout
//                           thrown errors."
//
//   socketTimeout           "The maximum time in milliseconds that a socket
//                           may remain idle before it is closed. Defaults to
//                           0, which means no maximum."
//
// So the old configuration had TWO faults compounding:
//
//   1. `requestTimeout` alone never aborts anything. It printed a line into
//      the log and let the request run. There was therefore NO inactivity
//      timeout on Bedrock at all, the retry ladder never engaged for a
//      stalled stream, and the only thing that ever stopped one was our own
//      guard - which is exactly why every failure arrived anonymous.
//
//   2. It is a TOTAL DURATION, not an idle measure. Sizing it for "a long
//      answer legitimately takes a while" was sizing the wrong quantity in
//      the wrong direction. Worse, it is a loaded gun: anybody who reads the
//      warning in the log and dutifully adds throwOnRequestTimeout: true
//      would kill EVERY reply longer than 45 seconds, which is most of the
//      good ones.
//
// WHAT IS SET NOW. `socketTimeout` is the idle timeout the old comment
// believed `requestTimeout` was. It rejects with a named TimeoutError
// saying how long the socket was quiet. `requestTimeout` is still
// deliberately NOT set: it is a TOTAL duration applied to every call
// through this one client, and a chat reply legitimately streams for
// minutes while a one-shot call must not - one number cannot serve both.
// Total ceilings therefore live with each CALLER, sized to what it asked
// for. See converseCeilingFor in converse.ts.
//
// AND SOCKETTIMEOUT IS NOT THE MAIN DETECTOR, WHICH IS A CORRECTION TO WHAT
// THIS BLOCK FIRST CLAIMED. It was written expecting the idle timeout to
// catch a dead call, with each caller's total ceiling as a rarely-used
// backstop. Production says the reverse: a stalled Bedrock call runs to the
// caller's ceiling every time and socketTimeout at 25s has not fired once.
// The socket is not idle during one - an AWS event stream carries periodic
// frames, so the connection stays busy while the model produces nothing.
//
// So this catches a genuinely dead socket, which is a real and different
// failure, and it cannot see the common one. Do not remove a caller's total
// ceiling on the strength of this option existing; that is the mistake the
// paragraph above it describes, in the other direction.
//
// TWENTY-FIVE SECONDS OF SILENCE IS ALREADY PATHOLOGICAL. Time to first
// token is a few seconds even on a large cached prompt, and mid-stream gaps
// are smaller still. One retry survives a genuine blip; more than that
// spends the reader's patience on hope.
//
// EVERY CALL MUST STREAM FOR THIS TO BE CORRECT, and that is not a caveat,
// it is a constraint this file imposes on its callers. A non-streaming
// ConverseCommand holds the socket open and silent for the entire time the
// model is generating, so an idle timeout would abort every one of them -
// which is precisely what a 2,000-token compaction call looked like. Both
// non-streaming call sites were converted to ConverseStreamCommand when
// this landed. Do not add a third.
// ===================================================================
export const BEDROCK_SOCKET_IDLE_MS = 25_000;
export const MAX_ATTEMPTS = 2;

// The SDK's own ceiling on one backoff sleep. Read from the source rather
// than assumed: @smithy/core/dist-cjs/submodules/retry declares
// MAXIMUM_RETRY_DELAY = 20 * 1000 and DEFAULT_RETRY_DELAY_BASE = 100, and
// the decider is
//
//   Math.floor(Math.min(MAXIMUM_RETRY_DELAY, Math.random() * 2 ** attempts * base))
//
// so with two attempts the REAL sleep is a fraction of a second and this is
// a deliberately pessimistic bound. Copied here because a caller cannot read
// a constant private to another package, and the previous version of this
// arithmetic used a made-up allowance that then drifted from the client it
// claimed to describe.
export const BEDROCK_RETRY_BACKOFF_CEILING_MS = 20_000;

// The longest the SDK can spend before it hands back a named failure:
// every attempt going silent for its full window, with a maximum backoff
// between them.
//
// A CALLER'S PHASE BUDGET MUST BE LONGER THAN THIS. Set one tighter and the
// caller aborts mid-ladder, the SDK's named TimeoutError is never thrown,
// and the failure arrives as a bare AbortError with no cause - the exact
// trap the old configuration fell into. bedrock-retry-budget.test.ts holds
// the line.
//
// ONE DELIBERATE EXCEPTION, AND IT IS NOT A LOOPHOLE: model-stream.ts bounds
// TIME TO FIRST EVENT at less than this on purpose. The rule above is about
// not losing a diagnosis, and that is why it holds - a phase budget firing
// mid-ladder yields "AbortError: Request aborted" and nothing else. The
// first-event deadline CATCHES its own abort and converts it into either
// another attempt or a named ModelSilentError, so nothing is lost and a
// stalled call is recovered instead of merely described.
//
// The interaction is worth knowing when reading a log. On a genuinely dead
// socket the SDK still wins the race - socketTimeout at 25s is inside the
// 30s first-event window - so that failure keeps its TimeoutError. What the
// tighter deadline cuts short is the SDK's SECOND attempt, which for this
// failure mode is redundant: model-stream re-issues the whole request
// anyway, and does it from a layer that can tell the reader what happened.
export const BEDROCK_LADDER_WORST_CASE_MS =
  BEDROCK_SOCKET_IDLE_MS * MAX_ATTEMPTS + BEDROCK_RETRY_BACKOFF_CEILING_MS * (MAX_ATTEMPTS - 1);

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
      // The idle timeout. See the block above for why this is not
      // `requestTimeout`, which only warns.
      socketTimeout: BEDROCK_SOCKET_IDLE_MS,
      connectionTimeout: CONNECT_TIMEOUT_MS,
    },
    // -----------------------------------------------------------------
    // STANDARD, AND NOT "adaptive". THIS IS A CORRECTION, AND IT IS THE ONE
    // THAT EXPLAINS "IT STOPS WORKING FOR EVERYONE AT ONCE".
    //
    // Both modes back off with jitter on throttling and transient 5xx, and
    // both decline to retry AccessDenied or ValidationException by design -
    // the first means the key is wrong, revoked or pointed at the wrong
    // region, the second means the request is malformed, and retrying
    // either just burns time. That much was true of the old comment here.
    //
    // What it did not say is what ADAPTIVE adds on top, which is a
    // CLIENT-SIDE RATE LIMITER. From @smithy/core's retry submodule:
    //
    //   AdaptiveRetryStrategy.acquireInitialRetryToken() {
    //     const token = await this.standardRetryStrategy...
    //     await this.rateLimiter.getSendToken();      // <- every request
    //   }
    //
    //   DefaultRateLimiter.acquireTokenBucket(amount) {
    //     if (!this.enabled) return;
    //     while (amount > this.availableTokens) {
    //       const delay = ((amount - this.availableTokens) / this.fillRate) * 1000;
    //       await new Promise((r) => setTimeout(r, delay));
    //       this.refillTokenBucket();
    //     }
    //   }
    //
    // Three properties of that, and every one of them is a problem here:
    //
    //   IT SLEEPS BEFORE THE REQUEST IS SENT. The wait happens in the retry
    //   strategy, ahead of the HTTP handler, so NEITHER connectionTimeout
    //   NOR socketTimeout bounds it - there is no socket yet. It is also
    //   absent from BEDROCK_LADDER_WORST_CASE_MS below, which therefore
    //   understates what a call can cost before any caller's deadline.
    //
    //   IT NEVER TURNS ITSELF OFF. `enabled` is set true by
    //   enableTokenBucket() on the first throttling response and there is no
    //   assignment back to false anywhere in the module. One throttle arms
    //   it for the LIFE OF THE PROCESS, which is why a restart appeared to
    //   fix this and nothing else did.
    //
    //   IT IS SHARED BY EVERYONE. The limiter belongs to the retry strategy,
    //   the strategy belongs to the client, and the client is the singleton
    //   below - one per Node process, not one per request. So the bucket is
    //   global: once armed, maxCapacity floors at 1 and fillRate at 0.5, and
    //   every user of this app is queueing through a bucket that admits
    //   roughly one request every two seconds. That is the mechanism behind
    //   "it was fine and then it stopped for everybody".
    //
    // Adaptive is built for a single-tenant batch client that owns its whole
    // service quota and wants to self-pace into it. A shared web request path
    // is the case it handles worst: the pacing is invisible, unbounded by any
    // timeout we set, and paid by whoever asks next.
    //
    // Standard mode keeps the backoff and drops the limiter. If throttling is
    // genuinely the problem it now arrives AS a ThrottlingException, with a
    // name, in the request log - which is a thing that can be diagnosed and
    // quota-adjusted, rather than silence.
    // -----------------------------------------------------------------
    maxAttempts: MAX_ATTEMPTS,
    retryMode: "standard",
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
