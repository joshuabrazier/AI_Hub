import "server-only";

import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { listSharepointDrivesRepo } from "@/lib/data/repositories/sharepoint-drive.repository";
import { listSharepointFoldersRepo } from "@/lib/data/repositories/sharepoint-item.repository";
import { countTranscriptionFilingsByStatusRepo } from "@/lib/data/repositories/transcription-filing.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
import { chooseFilingLibrary } from "@/lib/sharepoint/filing-library";
import { resolveFilingSubfolder } from "@/lib/sharepoint/filing-subfolder";
import { parseFolderPath } from "@/lib/sharepoint/folder-path";
import { MAX_FOLDER_OPTIONS } from "@/lib/sharepoint/filing.prompt";

import type { FilingSettingsDTO } from "./sharepoint.types";

// ===================================================================
// IS FILING SET UP, AND WHAT WOULD IT DO?
//
// WHY THIS SCREEN EXISTS AT ALL. Filing meeting notes into SharePoint was
// built as an automatic step at the end of a transcription, and it was
// therefore completely invisible: it ran, or it did not, and the only place
// either outcome appeared was a footnote at the bottom of one person's
// open transcription. An administrator had no way to answer "is this
// working", and the four separate things that have to be true for it to
// work are all environment or tenant settings THEY are the only one who can
// check.
//
// So this reports the configuration back, resolved the same way the filing
// service resolves it - by calling the same functions, not by describing
// them. A settings page that explains what the code is supposed to do is a
// second implementation that goes stale; this one asks.
//
// IT REPORTS COUNTS, NEVER CONTENT. A transcription is private from other
// users - that is the access model of the whole feature - and a meeting
// title is frequently the most disclosive thing about it. An admin list of
// everybody's filed notes would undo that in a screen nobody would think of
// as a privacy surface. What an admin can act on is the configuration and
// the shape of the failures; what happened to one particular meeting is
// shown to the person whose meeting it was.
// ===================================================================

// Reading the whole catalogue to count it would pull the library into memory
// to render one number. This is only ever compared against the prompt cap, so
// it stops as soon as it knows the answer.
const FOLDER_COUNT_PROBE_LIMIT = MAX_FOLDER_OPTIONS + 1;

export async function getFilingSettingsService(): Promise<FilingSettingsDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const drives = await listSharepointDrivesRepo();

    // The SAME call the filing service makes, so this cannot say filing will
    // use a library that filing then refuses to use.
    const choice = chooseFilingLibrary(
      drives.map((drive) => ({
        driveId: drive.driveId,
        siteName: drive.siteName,
        driveName: drive.driveName,
      })),
      envServer.SHAREPOINT_FILING_LIBRARY,
    );

    const library =
      choice.kind === "chosen"
        ? {
            driveId: choice.library.driveId,
            name: `${choice.library.siteName} / ${choice.library.driveName}`,
            problem: null,
          }
        : { driveId: null, name: null, problem: choice.reason };

    // Counted rather than listed, and capped: this is one number on a page,
    // not a catalogue.
    const folders =
      choice.kind === "chosen"
        ? await listSharepointFoldersRepo(choice.library.driveId, {
            maxDepth: envServer.SHAREPOINT_FILING_MAX_DEPTH,
            limit: FOLDER_COUNT_PROBE_LIMIT,
          })
        : [];

    const containers = new Set(
      envServer.SHAREPOINT_FILING_CONTAINER_PATHS.map((path) =>
        path.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase(),
      ),
    );

    const destinations = folders.filter(
      (folder) =>
        !containers.has(folder.path.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase()),
    ).length;

    // Validated with the same parser that runs at filing time, so a typo in
    // the setting is reported HERE - where somebody can fix it - rather than
    // discovered at the moment a meeting needed a home.
    const fallbackRaw = envServer.SHAREPOINT_FILING_FALLBACK_PATH ?? null;
    const fallback = parseFolderPath(fallbackRaw);

    // Resolved with the same function filing uses, so a name that filing
    // would refuse is reported HERE rather than discovered as an untidily
    // filed note weeks later.
    const subfolder = resolveFilingSubfolder(envServer.SHAREPOINT_FILING_SUBFOLDER);

    return {
      // Filing is off, rather than broken, when no library is nominated at
      // all. Told apart because the remedies are "set this up" and "fix
      // this", and reporting the first as the second sends somebody hunting
      // for a fault that is not there.
      isEnabled: drives.length > 0,
      library,
      folderCount: destinations,
      // True when the catalogue is larger than the prompt can carry, so the
      // model tier chooses from a partial list. The deterministic
      // client-name match still sees everything, which is why this is a
      // caveat rather than a failure.
      folderCountExceedsPromptCap: folders.length > MAX_FOLDER_OPTIONS,
      maxDepth: envServer.SHAREPOINT_FILING_MAX_DEPTH,
      excludedContainerPaths: envServer.SHAREPOINT_FILING_CONTAINER_PATHS,
      subfolderName: subfolder.ok ? subfolder.name : null,
      subfolderProblem: subfolder.ok ? null : subfolder.reason,
      fallbackPath: fallbackRaw,
      fallbackProblem: fallbackRaw !== null && !fallback.ok ? fallback.reason : null,
      // The model is the middle tier of three. Without it a meeting whose
      // client cannot be matched by name goes straight to the holding
      // folder, which works and is worth saying out loud.
      isModelTierAvailable: isBedrockConfigured(),
      counts: await countTranscriptionFilingsByStatusRepo(),
    };
  } catch (error) {
    throw handleError("getFilingSettingsService", error);
  }
}
