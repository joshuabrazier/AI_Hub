// -------------------------------------------------------------------
// ===================================================================
// WHAT THE HOSTING PLATFORM WILL ALLOW, WHICH IS SHORTER THAN ANY
// TIMEOUT THIS APP SETS
// ===================================================================
//
// Azure App Service severs an HTTP request whose connection has been idle for
// 230 seconds. A server action holds its connection open and sends nothing at
// all until it returns, so for any non-streaming caller that clock runs for
// the entire call.
//
// THE APP HAS TO GIVE UP FIRST OR THE FAILURE IS UNINVESTIGABLE. If the
// platform wins the race the connection is cut mid-flight and nothing in the
// app learns it happened: no log row, no error, nothing to look at. That is
// the exact state a failing project-plan draft was found in - it ran to a
// 297-second ceiling derived from its 8,000-token cap, a number that could
// never fire on a deployed environment because the platform is entitled to
// cut it 67 seconds earlier.
//
// -------------------------------------------------------------------
// WHY THIS IS ITS OWN FILE, WITH NOTHING IN IT BUT NUMBERS.
//
// It was written twice before landing here. First in the chat feature, as
// CHAT_PLATFORM_IDLE_CEILING_MS - which meant every other Bedrock call in the
// app (summaries, transcription, filing, project plans) knew nothing about it,
// because a lib cannot import from a feature. Then in bedrock-client.ts,
// which is the right layer and the wrong module: that file constructs an AWS
// client and is therefore mocked wholesale by several test suites, so a
// constant living in it cannot be imported by anything those suites also load
// without every one of their mocks growing a field.
//
// A module with no imports and no side effects has neither problem. Nothing
// needs to mock it, and nothing at any layer is barred from reading it.
// -------------------------------------------------------------------

/** Azure App Service's idle cut-off for an inbound request. */
export const PLATFORM_IDLE_CEILING_MS = 230_000;

// How far ahead of the platform our own deadline has to fire. The abort, the
// request-log write and the error's trip back to the caller all have to land
// inside this, so it is not decoration. 30 seconds is what the chat path
// already allowed for itself, so it is what everything else gets.
const PLATFORM_CEILING_MARGIN_MS = 30_000;

/**
 * The longest total duration a call may ask for and still fail on our terms.
 *
 * A ceiling past this is not a longer wait - it is a failure with no record of
 * itself, because the platform reports nothing when it cuts a connection.
 */
export const MAX_CALLER_CEILING_MS = PLATFORM_IDLE_CEILING_MS - PLATFORM_CEILING_MARGIN_MS;
