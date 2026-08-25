// -------------------------------------------------------------------
// Put CORS rules on the LOCAL storage emulator.
//
// WHY THIS EXISTS. Transcription uploads go browser-to-blob: the app signs
// a write-only URL and the browser PUTs the recording straight to storage,
// because pushing hundreds of megabytes through the app would tie up an
// instance for the length of the transfer. That is a CROSS-ORIGIN request -
// localhost:3100 talking to 127.0.0.1:10000 - so the blob service has to
// answer a preflight, and neither Azurite nor a fresh Azure account has any
// CORS rules at all. Without them the upload fails before it starts, and
// the browser reports it as a network error with nothing in the app's logs.
//
// WHY IT IS NOT DONE BY THE APP. CORS is set on the storage ACCOUNT, not on
// a container, and setProperties REPLACES the whole rule set. Running that
// against a shared production account would silently delete the rules
// belonging to every other application on it. So this is a deliberate,
// separate, local-only action rather than something that happens on boot.
//
// It REFUSES to run against anything but the emulator - see the guard
// below. In a real environment the rules are set once in the Portal; see
// docs/deployment.md.
//
// Run (once, with Azurite already running):
//   pnpm dev:storage        # in one terminal
//   node --env-file=.env scripts/configure-dev-storage.mjs
// -------------------------------------------------------------------
import { BlobServiceClient } from "@azure/storage-blob";

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (!connectionString) {
  console.error("AZURE_STORAGE_CONNECTION_STRING is not set. Nothing to configure.");
  process.exit(1);
}

// -------------------------------------------------------------------
// The guard. Two independent conditions, both of which are true only of a
// local emulator: the well-known development account name, and a plain
// HTTP endpoint on a loopback address. A real account satisfies neither,
// and requiring both means a connection string that merely looks unusual
// cannot slip through.
// -------------------------------------------------------------------
const isDevAccount = /AccountName=devstoreaccount1(;|$)/i.test(connectionString);
const isLoopbackHttp = /BlobEndpoint=http:\/\/(127\.0\.0\.1|localhost|azurite)[:/]/i.test(connectionString);

if (!isDevAccount || !isLoopbackHttp) {
  console.error(
    "REFUSING TO RUN. This script only configures the local Azurite emulator, and\n" +
      "AZURE_STORAGE_CONNECTION_STRING does not point at one.\n\n" +
      "Setting CORS replaces the whole rule set on a storage ACCOUNT, so running it\n" +
      "against a shared account would delete the rules other applications rely on.\n\n" +
      "For a real environment, set the rules in the Portal instead - see docs/deployment.md.",
  );
  process.exit(1);
}

// The dev server's origin. Read from the app URL so it follows the port
// rather than being a second place to keep in step with it.
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
const origin = new URL(appUrl).origin;

// 127.0.0.1 and localhost are DIFFERENT origins to a browser, and people
// reach a dev server by both, so both are allowed rather than leaving one
// of them to fail confusingly.
const origins = [...new Set([origin, origin.replace("localhost", "127.0.0.1"), origin.replace("127.0.0.1", "localhost")])];

const service = BlobServiceClient.fromConnectionString(connectionString);

const properties = await service.getProperties();

if (properties.cors && properties.cors.length > 0) {
  console.log(`Replacing ${properties.cors.length} existing CORS rule(s) on the emulator.`);
}

await service.setProperties({
  ...properties,
  cors: [
    {
      allowedOrigins: origins.join(","),
      // PUT does the upload. OPTIONS is the preflight. GET and HEAD are not
      // needed by the app - nothing reads a blob from the browser - but they
      // cost nothing here and save an afternoon if that ever changes.
      allowedMethods: "GET,HEAD,PUT,OPTIONS",
      // x-ms-blob-type is required on every block blob PUT, and content-type
      // carries the media type. A preflight fails without both named.
      allowedHeaders: "x-ms-blob-type,content-type,x-ms-blob-content-type",
      exposedHeaders: "",
      maxAgeInSeconds: 3600,
    },
  ],
});

console.log(`CORS configured on the emulator for: ${origins.join(", ")}`);
console.log("Recording and file upload should now work locally.");
