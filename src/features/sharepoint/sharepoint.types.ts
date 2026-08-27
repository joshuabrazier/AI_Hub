import { z } from "zod";

import type { SharepointCrawlStatus } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// SharePoint inventory - DTOs and input schemas.
//
// Phase 1 is read-only against SharePoint. The only writes anywhere in
// this feature are to our own tables: which library an admin nominated,
// and the record of crawling it.
// -------------------------------------------------------------------

// A URL is a long thing but not an unbounded one, and an unbounded string
// reaching a URL parser is an easy way to spend CPU on nothing.
const MAX_URL_LENGTH = 2048;

// -------------------------------------------------------------------
// Step one of nominating: find the libraries on a site.
//
// A READ, not a write. It resolves the pasted address through Graph and
// returns what is there, so the admin picks from real libraries rather
// than typing an opaque drive id nobody has.
// -------------------------------------------------------------------
export const FindLibrariesSchema = z.object({
  siteUrl: z.string().trim().min(1, "Enter the address of the SharePoint site").max(MAX_URL_LENGTH),
});

export type FindLibrariesDTO = z.infer<typeof FindLibrariesSchema>;

// -------------------------------------------------------------------
// Step two: nominate one of them.
//
// TAKES THE SITE URL AGAIN, AND ONLY AN ID BESIDES. The names, the web
// URL and the site id are NOT accepted from the form: the service
// re-resolves the site and admits the drive id only if it appears in the
// list Graph returns for it, then stores what Graph said.
//
// Same closed-vocabulary rule the timesheet view box follows, and for the
// same reason. The risk is not injection - Kysely parameterises everything
// - it is a row that LOOKS right. A form that supplied its own display
// name could put "Policies (read only)" in front of an admin next to a
// drive id that is something else entirely, and nothing downstream would
// ever disagree with it.
// -------------------------------------------------------------------
export const NominateLibrarySchema = z.object({
  siteUrl: z.string().trim().min(1).max(MAX_URL_LENGTH),
  driveId: z.string().trim().min(1).max(512),
});

export type NominateLibraryDTO = z.infer<typeof NominateLibrarySchema>;

export const DriveIdSchema = z.object({
  driveId: z.string().trim().min(1).max(512),
});

export type DriveIdDTO = z.infer<typeof DriveIdSchema>;

// -------------------------------------------------------------------
// A library on a site, as offered in the picker.
// -------------------------------------------------------------------
export interface SharepointLibraryOption {
  driveId: string;
  name: string;
  webUrl: string | null;
  // Already nominated. Offered anyway, but not as something to nominate
  // again - saying so is more use than hiding the row and leaving somebody
  // wondering where their library went.
  alreadyNominated: boolean;
}

export interface SharepointSiteLookup {
  siteName: string;
  siteWebUrl: string | null;
  libraries: SharepointLibraryOption[];
}

// -------------------------------------------------------------------
// A crawl, as the admin screen shows it.
//
// `statusLabel` is resolved server-side so one vocabulary serves the page
// and any future surface, and `isFailure` is separate from the status
// because two of the six are not failures: a throttled crawl resumes by
// itself, and one needing re-auth is waiting on a person, not on a fix.
// -------------------------------------------------------------------
export interface SharepointCrawlDTO {
  id: string;
  status: SharepointCrawlStatus;
  statusLabel: string;
  isFailure: boolean;
  isFinished: boolean;
  itemsSeen: number;
  pagesDone: number;
  error: string | null;
  throttledUntil: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

// -------------------------------------------------------------------
// A nominated library and what we hold about it.
// -------------------------------------------------------------------
export interface SharepointDriveDTO {
  driveId: string;
  siteName: string;
  driveName: string;
  webUrl: string;
  nominatedByName: string | null;
  // When the last full walk finished. NULL means no crawl has ever
  // completed, which is different from a library with nothing in it and
  // the page says so rather than showing a zero.
  lastCompletedAt: string | null;
  liveItems: number;
  liveFolders: number;
  deletedItems: number;
  totalBytes: number;
  latestCrawl: SharepointCrawlDTO | null;
}
