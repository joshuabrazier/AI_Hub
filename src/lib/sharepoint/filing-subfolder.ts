import { parseFolderPath } from "./folder-path";

// ===================================================================
// ONE FOLDER DEEPER: "Meeting Transcriptions" INSIDE THE CLIENT FOLDER
//
// Filing used to put the note straight into whichever folder it matched,
// which meant meeting notes landed in the middle of a client folder
// alongside contracts, drawings and invoices. It worked and it was untidy,
// and untidy is a real cost in a library ninety-five clients deep: the note
// is hard to find on purpose-built evidence and easy to find by accident.
//
// THIS WIDENS THE "ONLY ONE PATH IS EVER CREATED" RULE, AND THAT IS WORTH
// BEING EXPLICIT ABOUT rather than quietly true. Until now the single path
// this app would create was the configured holding folder, and the argument
// was that a model which could name a path could create one anywhere in the
// library. That argument still holds, and this does not breach it:
//
//   - the PARENT is always a folder the crawl already catalogued, addressed
//     by its Graph item id. The model chooses among ids from a closed list
//     and cannot name a path, exactly as before.
//   - the NAME is a constant from configuration. The model has no influence
//     over it at all.
//   - the DEPTH is exactly one. There is no tree to walk and no way to
//     express one.
//
// So the widening is precisely this: where a wrong destination used to leave
// a file in the wrong client's folder, it now leaves a folder and a file.
// That is more to tidy up and no more disclosive, and the tiers that choose
// the parent are unchanged.
//
// Pure, so the naming rules and the nesting rule are testable without a
// tenant.
// ===================================================================

// -------------------------------------------------------------------
// Plural, because it accumulates. One folder holds every meeting a client
// has ever had, and a folder called "Meeting Transcription" containing
// forty of them reads like a mistake.
//
// Configurable because it is a naming convention rather than a technical
// value, and the first person to disagree with this choice should be able to
// change it in one place rather than argue with a constant.
// -------------------------------------------------------------------
export const DEFAULT_FILING_SUBFOLDER = "Meeting Transcriptions";

export type FilingSubfolder =
  | { ok: true; name: string }
  // Named rather than thrown. This is read from configuration at the moment
  // a meeting needs filing, and a bad value should be reported as "your
  // setting is wrong" rather than as a failed filing.
  | { ok: false; reason: string };

// -------------------------------------------------------------------
// Validate the configured name, on exactly the rules SharePoint applies to
// any folder.
//
// REUSES parseFolderPath RATHER THAN REPEATING ITS RULES. That function
// already knows the forbidden characters, the reserved words, the trailing
// dot and the length cap, and a second copy of that list is a second copy
// that drifts. Passing a single name through it and requiring exactly one
// segment back also rejects the mistake somebody would actually make here:
// typing a path when a name was asked for.
// -------------------------------------------------------------------
export function resolveFilingSubfolder(configured: string | null | undefined): FilingSubfolder {
  const raw = (configured ?? "").trim();

  // Unset means the default rather than "no subfolder". Turning the feature
  // off is a separate decision and would need its own setting - an empty
  // string is far more likely to be an accident.
  const value = raw.length > 0 ? raw : DEFAULT_FILING_SUBFOLDER;

  const parsed = parseFolderPath(value);

  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  if (parsed.segments.length !== 1) {
    return {
      ok: false,
      reason: `"${value}" is a path, not a folder name. Meeting notes go one folder deep inside the folder that was matched.`,
    };
  }

  return { ok: true, name: parsed.segments[0] };
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// -------------------------------------------------------------------
// Is the folder we chose already the subfolder?
//
// A REAL CASE, AND A BUG IF IGNORED. Once these subfolders exist and the
// library is crawled again, the catalogue contains one "Meeting
// Transcriptions" per client - and they are offered to the model as
// candidates like any other folder. A model that helpfully picks
// "Clients/Acme/Meeting Transcriptions" directly would otherwise get
// "Clients/Acme/Meeting Transcriptions/Meeting Transcriptions", and then
// another one next year.
//
// Compared on the NAME rather than the path, because the same answer is
// wanted however the folder was reached: matched by client name, chosen by
// the model, or configured as the holding folder.
// -------------------------------------------------------------------
export function isAlreadySubfolder(folderName: string, subfolderName: string): boolean {
  return normalise(folderName) === normalise(subfolderName);
}

// -------------------------------------------------------------------
// The path to record, once the subfolder is in play.
//
// The stored path is a SNAPSHOT of where the note went, and it has to name
// the folder the file is actually in - not its parent. A record pointing one
// level up is the kind of near-miss that wastes somebody's afternoon when
// they go looking.
// -------------------------------------------------------------------
export function subfolderPath(parentPath: string, subfolderName: string): string {
  const trimmed = parentPath.replace(/\/+$/, "");

  // The drive root reports itself as "/", so joining naively would produce
  // "//Meeting Transcriptions".
  return trimmed === "" || trimmed === "/" ? `/${subfolderName}` : `${trimmed}/${subfolderName}`;
}
