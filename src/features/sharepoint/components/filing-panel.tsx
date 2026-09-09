import { CircleCheck, CircleSlash, FolderTree, TriangleAlert } from "lucide-react";

import { TRANSCRIPTION_FILING_STATUS_LABELS } from "@/lib/data/kysely-database-types";

import type { FilingSettingsDTO } from "../sharepoint.types";

// ===================================================================
// FILING MEETING NOTES: IS IT SET UP, AND WHAT WOULD IT DO?
//
// This panel exists because the feature was invisible. Filing runs
// automatically when a transcription finishes, so from an administrator's
// side it either happened or it did not, and the only place either outcome
// appeared was a footnote at the bottom of one person's open transcription.
// Four separate things have to be true for it to work and every one of them
// is an environment or tenant setting only an admin can check.
//
// SO IT REPORTS THE RESOLVED CONFIGURATION, not a description of it. Each
// value here comes from the same function the filing service calls, so this
// cannot claim filing will use a library that filing then refuses to use.
//
// COUNTS, NEVER CONTENT. A transcription is private from other users, and a
// meeting title is often the most disclosive thing about it - "redundancy
// consultation" tells you the whole story. So the numbers say whether the
// configuration is working and the reason for any one filing is shown to the
// person whose meeting it was.
//
// THE SPLIT BETWEEN "nowhere" AND "failed" IS THE ACTIONABLE PART, which is
// why they are not added together into "problems". The first means the
// configuration cannot choose a destination and is fixed in an environment
// variable; the second means SharePoint refused and is fixed in Entra. Two
// different people, two different afternoons.
// ===================================================================
export function FilingPanel({ settings }: { settings: FilingSettingsDTO }) {
  // Not configured is a state, not a fault. Saying so plainly stops somebody
  // debugging a feature nobody turned on.
  if (!settings.isEnabled) {
    return (
      <section className="rounded-xl border border-dashed border-border p-6">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FolderTree size={16} className="text-muted-foreground" aria-hidden="true" />
          Filing meeting notes
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Once a library is nominated and crawled, meeting notes are filed into it automatically when a
          transcription finishes. Nominate one above to turn that on.
        </p>
      </section>
    );
  }

  const problems = [
    settings.library.problem,
    settings.fallbackProblem,
    settings.subfolderProblem,
    // A chosen library with nothing in it is the commonest real failure and
    // does not look like one: everything is configured and every meeting
    // still goes to the holding folder.
    settings.folderCount === 0 && settings.library.driveId !== null
      ? "No folders have been catalogued for this library yet, so nothing can be matched. Run a crawl above."
      : null,
  ].filter((problem): problem is string => problem !== null);

  return (
    <section className="rounded-xl border border-border">
      <div className="border-b border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FolderTree size={16} className="text-muted-foreground" aria-hidden="true" />
          Filing meeting notes
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          When a transcription finishes, its notes are written into this library as a markdown file. The
          folder is chosen by matching the client named in the meeting title against the catalogued folder
          names, and where that is not certain, either by asking the model to choose from those same folders
          or by using the holding folder below. The note then goes into a folder of its own inside that one,
          so transcripts do not sit among a client&apos;s contracts and drawings.
        </p>
      </div>

      {problems.length > 0 && (
        <div className="border-b border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <TriangleAlert size={14} className="text-destructive" aria-hidden="true" />
            {problems.length === 1 ? "One thing needs fixing" : `${problems.length} things need fixing`}
          </p>
          <ul className="mt-2 space-y-1">
            {problems.map((problem) => (
              // The sentence, verbatim. Each of these is somebody's
              // environment variable and the message is the whole remedy.
              <li key={problem} className="break-words text-xs leading-relaxed text-muted-foreground">
                {problem}
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
        <Setting
          label="Library"
          value={settings.library.name ?? "Not chosen"}
          ok={settings.library.name !== null}
        />
        <Setting
          label="Folders it can choose from"
          value={
            settings.folderCount === 0
              ? "None catalogued"
              : `${settings.folderCount.toLocaleString()}, to ${settings.maxDepth} levels deep`
          }
          ok={settings.folderCount > 0}
          note={
            settings.folderCountExceedsPromptCap
              ? "More than the model can be shown at once, so it chooses from the first of them. Matching a client by name still searches every folder."
              : null
          }
        />
        <Setting
          label="Notes go into"
          value={
            settings.subfolderName !== null
              ? `a "${settings.subfolderName}" folder inside the folder that was matched`
              : "the matched folder directly"
          }
          ok={settings.subfolderProblem === null}
          note="Created if it is not there. It is the only folder the app makes inside a client folder, it is only ever one level deep, and its name comes from configuration rather than from the model."
        />
        <Setting
          label="Holding folder"
          value={settings.fallbackPath ?? "None, so anything uncertain is left unfiled"}
          // Unset is a legitimate permanent answer, so it is not a fault -
          // it means ambiguity is reported rather than guessed at. Only a
          // path that is set AND invalid is wrong.
          ok={settings.fallbackProblem === null}
          note={
            settings.fallbackPath === null
              ? "This is the only path the app will ever create. Without one, a meeting nothing matches is reported instead."
              : null
          }
        />
        <Setting
          label="Model can suggest a folder"
          value={settings.isModelTierAvailable ? "Yes" : "No, name matching and the holding folder only"}
          ok={settings.isModelTierAvailable}
        />

        {settings.excludedContainerPaths.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Not used as destinations</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {settings.excludedContainerPaths.map((path) => (
                <span
                  key={path}
                  className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {path}
                </span>
              ))}
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              Folders that hold the client folders rather than being one. A meeting note belongs in one of
              those, not in the lobby.
            </p>
          </div>
        )}
      </dl>

      <div className="border-t border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What has been filed
        </p>

        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          <Count label={TRANSCRIPTION_FILING_STATUS_LABELS.filed} value={settings.counts.filed} />
          <Count label={TRANSCRIPTION_FILING_STATUS_LABELS.pending} value={settings.counts.pending} />
          <Count
            label={TRANSCRIPTION_FILING_STATUS_LABELS.nowhere}
            value={settings.counts.nowhere}
            emphasis={settings.counts.nowhere > 0}
          />
          <Count
            label={TRANSCRIPTION_FILING_STATUS_LABELS.failed}
            value={settings.counts.failed}
            emphasis={settings.counts.failed > 0}
          />
        </dl>

        {/* The two failure counts mean different things and are fixed by
            different people, so the difference is spelled out rather than
            left for somebody to infer from two labels. */}
        <p className="mt-3 max-w-2xl text-xs text-muted-foreground">
          {settings.counts.nowhere > 0
            ? "Nowhere to file it means no folder could be chosen and no holding folder was available - a settings problem. "
            : ""}
          {settings.counts.failed > 0
            ? "Could not be filed means SharePoint refused the write, which is usually the Files.ReadWrite.All permission missing or not consented. "
            : ""}
          Counts only: what happened to any one meeting is shown to the person whose meeting it was, because
          a transcription is private from everybody else.
        </p>
      </div>
    </section>
  );
}

// One resolved setting, with a mark saying whether it is usable. The mark is
// not decoration: this page exists to answer "is it set up", and four values
// with no verdict leaves the reader doing the checking.
function Setting({
  label,
  value,
  ok,
  note = null,
}: {
  label: string;
  value: string;
  ok: boolean;
  note?: string | null;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex items-start gap-1.5 text-sm text-foreground">
        {ok ? (
          <CircleCheck size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <CircleSlash size={14} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
        )}
        <span className="break-words">{value}</span>
      </dd>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Count({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd
        className={`font-mono text-lg tabular-nums ${emphasis ? "text-destructive" : "text-foreground"}`}
      >
        {value.toLocaleString()}
      </dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
