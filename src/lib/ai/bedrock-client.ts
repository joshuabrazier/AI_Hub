import "server-only";

import { Agent } from "node:https";

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

// ===================================================================
// THE CONNECTION POOL, AND THE WAIT THAT NO TIMEOUT IN THIS FILE COVERS.
//
// THIS IS THE ONE THAT ONLY HAPPENS IN PRODUCTION, and the asymmetry is the
// evidence: the same Bedrock key, region and model served a working dev
// portal while production was dead for everybody. A model-side problem
// cannot do that. A per-process resource can, and this is one.
//
// WHAT THE SDK DOES BY DEFAULT. @smithy/node-http-handler's
// resolveDefaultConfig sets, in its own words:
//
//   const keepAlive = true;
//   const maxSockets = 50;
//   ...
//   httpsAgent: new node_https.Agent({ keepAlive, maxSockets, ...httpsAgent })
//
// So there is a cap of FIFTY concurrent connections, and it is per AGENT -
// which means per client, which means per PROCESS, because the client below
// is a module singleton and the deploy runs a single App Service instance.
// Fifty is the whole application's simultaneous Bedrock capacity, shared by
// every user of it.
//
// WHY EXHAUSTING IT IS SILENT, which is the actual defect. When every socket
// is checked out, Node's Agent does not fail the next request - it QUEUES it,
// with no deadline, until a socket frees. And a queued request has no socket
// yet, so neither of the timeouts above can see it: connectionTimeout bounds
// establishing a connection that has not been attempted, and socketTimeout
// bounds idleness on a socket that has not been assigned. The request simply
// waits. From the caller's side that is indistinguishable from a model that
// accepted the question and said nothing, which is exactly how it was
// reported.
//
// AND A STREAMING CALL HOLDS ITS SOCKET FOR THE WHOLE REPLY. This is what
// makes fifty reachable in a way it would not be for ordinary requests: a
// chat answer streams for as long as it takes to write, up to
// MAX_OUTPUT_TOKENS, and every concurrent reply, meeting summary, filing
// call and transcription summary is holding one the entire time. Dev never
// gets near it - one person, one question at a time, and the process is
// restarted constantly - which is precisely why it worked there.
//
// WHAT IS SET, AND WHY EACH NUMBER.
//
//   keepAlive stays TRUE, and is restated rather than inherited because on
//   Azure it is load-bearing for a second reason. App Service gives an
//   instance a small pool of outbound SNAT ports, and a fresh TCP connection
//   per request burns one for minutes after it closes. Reusing connections is
//   what keeps that pool from being the next thing to run out.
//
//   maxSockets is raised to leave HEADROOM over what this app can genuinely
//   need at once, and is deliberately not Infinity: unlimited sockets would
//   trade a queue nobody can see for a SNAT pool nobody can see, and the
//   second failure is worse because it takes Graph, blob storage and email
//   down with it.
//
//   maxFreeSockets is small on purpose. An idle kept-alive socket still holds
//   an outbound port, so the pool keeps a few warm and lets the rest go.
//
//   keepAliveMsecs is well under Azure's own idle teardown, so a connection
//   is reused or released by us rather than being severed underneath us and
//   surfacing as a socket hang-up mid-reply.
//
// A NOTE FOR WHOEVER READS A LOG NEXT. The SDK detects this state itself and
// says so - NodeHttpHandler.checkSocketUsage logs
// "@smithy/node-http-handler:WARN - socket usage at capacity=N and M
// additional requests are enqueued" - but only once the queue is already
// twice the cap, and by then everybody has been broken for a while. The
// warning threshold is pulled forward below so it fires while there is still
// something to learn from it.
// ===================================================================
export const BEDROCK_MAX_SOCKETS = 128;
export const BEDROCK_MAX_FREE_SOCKETS = 8;
export const BEDROCK_KEEP_ALIVE_MS = 30_000;

/**
 * The cap this replaces, from @smithy/node-http-handler's
 * resolveDefaultConfig. Named so the test asserting we are above it says
 * what it is above, and so nobody "tidies up" the agent back to a number
 * that was the whole application's concurrent capacity.
 */
export const SMITHY_DEFAULT_MAX_SOCKETS = 50;

/**
 * Azure App Service severs an outbound connection idle for four minutes.
 * Anything we keep alive has to be reused or released well inside that, or
 * the teardown arrives as a socket hang-up in the middle of a reply.
 */
export const AZURE_OUTBOUND_IDLE_MS = 240_000;

// How long a request may sit waiting for a socket before the SDK logs that
// the pool is at capacity. Deliberately short: this is a diagnostic, and the
// question it answers - "is anything queueing at all" - is only useful
// before the queue has grown long enough to hurt.
const SOCKET_WAIT_WARNING_MS = 5_000;

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
      // The pool. Stated rather than inherited, because the default cap of
      // 50 is the whole process's concurrent Bedrock capacity and running
      // out of it is a wait no timeout in this file can see. See THE
      // CONNECTION POOL above.
      httpsAgent: new Agent({
        keepAlive: true,
        keepAliveMsecs: BEDROCK_KEEP_ALIVE_MS,
        maxSockets: BEDROCK_MAX_SOCKETS,
        maxFreeSockets: BEDROCK_MAX_FREE_SOCKETS,
      }),
      // Pulled forward from its default so the SDK's own capacity warning
      // appears while the queue is still short enough to be a clue rather
      // than an obituary.
      socketAcquisitionWarningTimeout: SOCKET_WAIT_WARNING_MS,
    },
    maxAttempts: MAX_ATTEMPTS,
    // -----------------------------------------------------------------
    // STANDARD, NOT ADAPTIVE, AND THIS ONE WORD WAS A PRODUCTION FAULT.
    //
    // Adaptive mode adds a CLIENT-SIDE RATE LIMITER on top of the backoff,
    // and its behaviour is not what the name suggests. From
    // @smithy/core's DefaultRateLimiter:
    //
    //   async acquireTokenBucket(amount) {
    //     if (!this.enabled) return;
    //     this.refillTokenBucket();
    //     while (amount > this.availableTokens) {
    //       const delay = ((amount - this.availableTokens) / this.fillRate) * 1000;
    //       await new Promise((resolve) => setTimeoutFn(resolve, delay));
    //       this.refillTokenBucket();
    //     }
    //     ...
    //   }
    //
    // Three properties of that, each bad here and worse together:
    //
    //   1. IT SLEEPS BEFORE THE REQUEST IS SENT. No socket is open while it
    //      waits, so socketTimeout cannot see it and neither can anything
    //      else at the transport layer. A call can spend its entire
    //      caller-side ceiling in this loop having never reached AWS - which
    //      is exactly the signature we measured: the full ceiling elapsed,
    //      $metadata reporting attempts: 2 and totalRetryDelay: 94ms,
    //      because the limiter's sleep is not retry delay and is not counted.
    //
    //   2. IT LATCHES ON AND NEVER OFF. enableTokenBucket() sets enabled =
    //      true on the first throttling response, and nothing in the file
    //      ever sets it false again. One throttled burst degrades every
    //      later call.
    //
    //   3. THE CLIENT IS A PROCESS-WIDE SINGLETON (see cachedClient below),
    //      so the limiter is shared by chat, summaries, transcription and
    //      filing alike. A sweep firing a burst of background calls could
    //      therefore slow down somebody's chat reply, with nothing in either
    //      feature to explain why.
    //
    //   4. IT IS INVISIBLE TO THE ARITHMETIC IN THIS FILE.
    //      BEDROCK_LADDER_WORST_CASE_MS below is built from the socket idle
    //      timeout and the backoff ceiling, because those are the parts the
    //      SDK documents. The limiter's sleep is neither, so every caller
    //      sizing a budget against that constant was sizing it against a
    //      number that understated what a call could cost before it began.
    //
    // Adaptive is built for a single-tenant batch client that owns its whole
    // service quota and wants to self-pace into it. A shared web request path
    // is the case it handles worst: the pacing is invisible, bounded by no
    // timeout we set, and paid by whoever asks next.
    //
    // Standard mode retries with exponential backoff and jitter and NO
    // pre-send rate limiting, so a throttle arrives as a fast, named
    // ThrottlingException. That is the outcome worth having: a name tells
    // somebody to ask AWS for a quota increase, and an unexplained sixty
    // seconds does not.
    //
    // AccessDenied and ValidationException are not retried in either mode,
    // by design: the first means the key is wrong, revoked or pointed at the
    // wrong region, and the second means the request is malformed. Retrying
    // either just burns time.
    // -----------------------------------------------------------------
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
