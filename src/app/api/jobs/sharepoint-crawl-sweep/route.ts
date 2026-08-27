import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sweepSharepointCrawlsService } from "@/features/sharepoint-sync/sharepoint-crawl.service";
import { envServer } from "@/lib/env-server";

// Talks to Graph and Postgres, so Node; and its answer is about this
// minute, so it must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time bearer check so a wrong secret cannot be timed out.
function bearerMatches(header: string | null, secret: string): boolean {
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// -------------------------------------------------------------------
// POST /api/jobs/sharepoint-crawl-sweep
//
// Carries every unfinished crawl forward by one slice. Meant to be called
// on a timer, every minute or two.
//
// A CRAWL CANNOT FINISH WITHOUT THIS. Starting one from the admin screen
// only writes a queued row - a large library is hundreds of delta pages,
// which is far too much work to hold a request open for. So the button
// queues and this endpoint walks, a bounded number of pages at a time,
// saving its place after every page.
//
// AUTHENTICATION IS THIS BEARER SECRET AND NOTHING ELSE. There is no
// session behind a scheduler, so the usual role guards do not apply and
// must not be added. What sits behind it is the one service in the feature
// that acts on rows it did not resolve from a session - it mints a Graph
// token for whoever the crawl runs as, who is very likely not present -
// which is precisely why the door in front of it is locked this way.
//
// Inert until SHAREPOINT_SWEEP_SECRET is set, exactly like the transcription
// sweep and the retention job, so deploying this cannot start reading
// somebody's document library on its own.
// -------------------------------------------------------------------
export async function POST(request: Request): Promise<Response> {
  const secret = envServer.SHAREPOINT_SWEEP_SECRET;

  // No secret configured => the endpoint is intentionally inert.
  if (!secret) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await sweepSharepointCrawlsService();

  // Counts and statuses only - no drive ids, no site names, no file paths -
  // so a scheduler's logs do not become a second, unguarded copy of the
  // disclosive part of the inventory.
  console.info(
    `[sharepoint-crawl-sweep] reclaimed=${result.reclaimed} examined=${result.examined} ` +
      `statuses=${result.slices.map((slice) => slice.status).join(",") || "none"}`,
  );

  return NextResponse.json({
    ok: true,
    reclaimed: result.reclaimed,
    examined: result.examined,
    slices: result.slices.map((slice) => ({
      status: slice.status,
      pagesDone: slice.pagesDone,
      itemsSeen: slice.itemsSeen,
      itemsDeleted: slice.itemsDeleted,
    })),
  });
}
