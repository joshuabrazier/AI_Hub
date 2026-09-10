import { FolderSearch } from "lucide-react";

import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { envServer } from "@/lib/env-server";

import { FilingPanel } from "./components/filing-panel";
import { LibraryCard } from "./components/library-card";
import { NominateLibraryForm } from "./components/nominate-library-form";
import { getFilingSettingsAction, getSharepointDrivesAction } from "./sharepoint.actions";

// -------------------------------------------------------------------
// SharePoint: the catalogue, and what gets written back into it.
//
// THIS PAGE USED TO PROMISE "Nothing in SharePoint is changed", AND THAT
// STOPPED BEING TRUE. It was accurate while the feature only crawled, and
// it survived unchanged when filing was added - so the screen an admin
// reads before pointing this at a real client library was telling them the
// app could not write to it, at the same time as the app was writing to it.
// A stale promise about somebody else's system is worse than no promise,
// because it is the one they will quote back.
//
// What is true now, and what the page says:
//
//   THE CRAWL IS READ-ONLY. Names, sizes, folder structure, who last
//   touched what. Nothing is moved, renamed or deleted by it, and no code
//   path in the crawl could.
//
//   FILING WRITES, and only in two shapes: a new markdown file of meeting
//   notes into a folder the crawl already found, and - only if a holding
//   folder is configured - that one path created if it is missing. It never
//   overwrites: an upload that collides with an existing name is reported
//   as the file that was already there. Nothing is ever deleted.
//
// The catalogued names alone are disclosive, which is why removing a
// library really removes what we hold about it.
// -------------------------------------------------------------------
export default async function SharepointPage() {
  const response = await getSharepointDrivesAction();

  // Read alongside the libraries rather than behind a tab. Whether filing
  // works depends almost entirely on whether a library is nominated and
  // crawled, so putting the answer on a different screen from the controls
  // that decide it is how somebody ends up reading one and acting on the
  // other.
  const filing = await getFilingSettingsAction();

  // Without the sweep configured, a crawl is queued and then nothing walks
  // it. Saying so on the page is the difference between "this is broken"
  // and "this needs an environment variable".
  const sweepConfigured = Boolean(envServer.SHAREPOINT_SWEEP_SECRET);

  return (
    <StandardTablePage response={response}>
      {(drives) => (
        <PortalPage
          eyebrow="Admin"
          title="SharePoint"
          description="Catalogue a document library so its structure can be reviewed, and file meeting notes into it. The crawl only reads, and filing writes nothing until the person whose meeting it is confirms the folder. Nothing is ever renamed, overwritten or deleted."
        >
          <NominateLibraryForm />

          {!sweepConfigured ? (
            <div
              role="status"
              className="mb-8 rounded-xl border border-data-caution/40 bg-data-caution-surface p-4 text-sm text-data-caution-text"
            >
              <p className="font-semibold">Crawls will queue but not run.</p>
              <p className="mt-0.5">
                SHAREPOINT_SWEEP_SECRET is not set, so nothing is scheduled to carry a crawl forward. Set it and
                point a timer at /api/jobs/sharepoint-crawl-sweep.
              </p>
            </div>
          ) : null}

          {drives.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <FolderSearch size={22} aria-hidden="true" className="mx-auto text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">No libraries yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Paste the address of a SharePoint site above to see the document libraries on it.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {drives.map((drive) => (
                <LibraryCard key={drive.driveId} drive={drive} />
              ))}
            </div>
          )}

          {/* Below the libraries, because filing depends on one being
              nominated and crawled - the controls that decide the answer
              come first, then the answer. */}
          {filing.success && filing.data ? (
            <div className="mt-8">
              <FilingPanel settings={filing.data} />
            </div>
          ) : null}
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
