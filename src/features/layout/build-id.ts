import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

// The constant lives with the DECISION rather than here, because the client
// has to recognise it too and this module is server-only.
import { UNKNOWN_BUILD_ID } from "./deployment-watch";

// -------------------------------------------------------------------
// Which build is serving this process.
//
// Read from `.next/BUILD_ID` rather than an environment variable, and that
// choice is the difference between working and a reload loop. A value baked
// in through next.config's `env` is inlined into the client bundle at BUILD
// time but re-evaluated on the server at RUNTIME; generate it from a
// timestamp or a git call and the two disagree for ever, every poll reports a
// "new" build, and every tab reloads until somebody closes it.
//
// BUILD_ID is written once by `next build` and cannot change while this
// server runs - a new build is a new deployment and therefore a new process.
// It is also the RIGHT id rather than a proxy for one: Next derives its
// server action hashes from that same build, so a tab whose BUILD_ID differs
// is exactly a tab whose action ids the server will reject.
//
// -------------------------------------------------------------------
// ONLY A SUCCESSFUL READ IS CACHED, and the distinction is not pedantry.
//
// The first version cached the failure too. One transient read error - a
// cold container still unpacking, a momentary EMFILE - and every tab that
// deployment ever serves is told "unknown" for the life of the process,
// which permanently and SILENTLY disables deployment detection for that
// instance. Nothing would look wrong; stale tabs would simply stop being
// noticed, which is the bug this whole feature exists to fix.
//
// A failure is therefore reported and retried on the next call. The read is
// one small file and the success path is cached, so retrying costs nothing
// in the normal case.
//
// -------------------------------------------------------------------
// IT IS ALSO CALLED AT BUILD TIME, by the root layout, while Next prerenders
// the static routes - and that is correct rather than merely tolerable.
// `next build` writes `.next/BUILD_ID` before it generates static pages (see
// writeBuildId in next/dist/build/index.js, which runs well ahead of the
// export step), so a prerendered page is stamped with the build that
// produced it. Which is exactly what the tab needs: static HTML held in a
// browser cache from an older deployment carries that older id and is
// noticed as stale, rather than adopting whatever the first poll says.
// -------------------------------------------------------------------
let cached: string | null = null;

export async function getBuildId(): Promise<string> {
  if (cached) return cached;

  try {
    // `process.cwd()` is the app root under both `next start` and the
    // standalone server, which places .next beside the server it runs.
    const raw = await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8");
    const buildId = raw.trim();

    // An empty file is a failure, not a build called "". Falling through
    // without caching means the next call tries again.
    if (buildId.length > 0) {
      cached = buildId;
      return cached;
    }
  } catch {
    // Development has no BUILD_ID at all, which is the ordinary case rather
    // than an error worth logging on every request.
  }

  return UNKNOWN_BUILD_ID;
}
