// -------------------------------------------------------------------
// Splitting a configured folder path into segments that are safe to create.
//
// THE MODEL CAN NEVER REACH THIS, AND THAT IS THE POINT. Folder creation is
// the only write in this feature that invents something rather than choosing
// from what exists, so the path it acts on comes from CONFIGURATION and
// nowhere else. The model picks among folders the crawl already found; if it
// picks nothing, the app falls back to a folder an administrator named. There
// is deliberately no route from model output to a created folder, because a
// model that could name a path could create one anywhere in the library.
//
// This validates anyway. The configured value is typed by a person into an
// environment variable, and people typo - a leading slash, a doubled
// separator, a stray "..", a trailing space that SharePoint silently strips
// and then cannot find again.
//
// SharePoint's own rules are the second reason. These characters are
// rejected in names, a name cannot end in a dot or a space, and several
// words are reserved. Discovering that from a 400 halfway through creating a
// tree leaves a half-made path behind; discovering it here does not.
// -------------------------------------------------------------------

// Documented as invalid in a SharePoint file or folder name.
//
// TWO REGEXES FOR ONE RULE, deliberately. A global regex is STATEFUL when
// used with .test() - it carries lastIndex between calls and returns false
// every other time on the same input - so the validator gets the plain one
// and the sanitiser gets the global one. Sharing a single global regex
// between them is a bug that surfaces intermittently, which is the worst
// kind to chase.
//
// And the sanitiser genuinely needs the global flag: .replace() without it
// strips only the FIRST offending character, so "Review: Q3/Q4 <plans>" came
// back still carrying a slash and a bracket. Caught by a test rather than by
// somebody finding a file SharePoint had refused to accept.
const FORBIDDEN_CHARACTERS = /["*:<>?/\\|]/;
const FORBIDDEN_CHARACTERS_GLOBAL = /["*:<>?/\\|]/g;

// SharePoint reserves these outright, case-insensitively.
const RESERVED_NAMES = new Set(["con", "prn", "aux", "nul", ".lock", "desktop.ini", "_vti_"]);

// Beyond this, SharePoint starts refusing paths outright. Kept well under
// the documented limit so a long file name added underneath still fits.
const MAX_PATH_LENGTH = 300;
const MAX_SEGMENT_LENGTH = 100;

// A fallback folder is realistically one to three deep. Anything like forty
// is a typo or a pasted URL, and creating that tree would leave a nest of
// empty folders for somebody to hunt down and delete.
const MAX_SEGMENTS = 6;

export type FolderPathResult =
  | { ok: true; segments: string[] }
  // Named rather than thrown. This is read from configuration at the moment
  // somebody needs a fallback folder, and a misconfigured value should be
  // reported as "your setting is wrong" rather than as a failed filing.
  | { ok: false; reason: string };

export function parseFolderPath(raw: string | null | undefined): FolderPathResult {
  const value = (raw ?? "").trim();

  if (!value) return { ok: false, reason: "No folder path is configured." };

  if (value.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: `The folder path is longer than ${MAX_PATH_LENGTH} characters.` };
  }

  // Backslashes are accepted as separators and normalised, because somebody
  // typing a Windows-looking path into a setting is a matter of when.
  const segments = value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return { ok: false, reason: "The folder path has no folder names in it." };

  if (segments.length > MAX_SEGMENTS) {
    return {
      ok: false,
      reason: `The folder path is ${segments.length} folders deep; ${MAX_SEGMENTS} is the most that will be created.`,
    };
  }

  for (const segment of segments) {
    // "." and ".." are the ones that matter. A path that walks upwards would
    // address a write outside the folder somebody configured, which is the
    // whole reason this function exists rather than a split call.
    if (segment === "." || segment === "..") {
      return { ok: false, reason: 'A folder path cannot contain "." or ".." segments.' };
    }

    if (segment.length > MAX_SEGMENT_LENGTH) {
      return { ok: false, reason: `"${segment}" is longer than ${MAX_SEGMENT_LENGTH} characters.` };
    }

    if (FORBIDDEN_CHARACTERS.test(segment)) {
      return { ok: false, reason: `"${segment}" contains a character SharePoint does not allow in a folder name.` };
    }

    // SharePoint strips a trailing dot or space and then cannot find the
    // folder by the name you asked for, which reads as the folder having
    // vanished. The trim above handles spaces; this catches the dot.
    if (segment.endsWith(".")) {
      return { ok: false, reason: `"${segment}" ends in a dot, which SharePoint does not allow.` };
    }

    if (RESERVED_NAMES.has(segment.toLowerCase())) {
      return { ok: false, reason: `"${segment}" is a name SharePoint reserves.` };
    }
  }

  return { ok: true, segments };
}

// -------------------------------------------------------------------
// A file name for a meeting's notes.
//
// Built from the meeting rather than from anything a model wrote, and
// sanitised on exactly the rules above - a title is user input twice over,
// typed into a calendar by somebody who may not have been thinking about
// SharePoint.
//
// The date leads so a folder sorts chronologically, which is how somebody
// looks for a meeting they half-remember.
// -------------------------------------------------------------------
export function buildNotesFileName(input: { workDate: string; title: string; extension: string }): string {
  const safeTitle = input.title
    .replace(FORBIDDEN_CHARACTERS_GLOBAL, " ")
    .replace(/[#%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Long enough to identify a meeting, short enough that the whole path
    // stays inside SharePoint's limit once the folder tree is in front of it.
    .slice(0, 80)
    .replace(/[.\s]+$/, "");

  const stem = safeTitle.length > 0 ? `${input.workDate} ${safeTitle}` : input.workDate;

  return `${stem}.${input.extension}`;
}
