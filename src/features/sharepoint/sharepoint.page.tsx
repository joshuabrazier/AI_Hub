import { FolderSearch } from "lucide-react";

import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { envServer } from "@/lib/env-server";

import { LibraryCard } from "./components/library-card";
import { NominateLibraryForm } from "./components/nominate-library-form";
import { getSharepointDrivesAction } from "./sharepoint.actions";

// -------------------------------------------------------------------
// SharePoint inventory.
//
// READ-ONLY AGAINST SHAREPOINT, and the page says so because it is the
// thing an admin most needs to be sure of before pointing this at a real
// library. Nothing here moves, renames, deletes or creates anything in
// SharePoint, and there is no code path in the feature that could.
//
// What it does is catalogue: names, sizes, folder structure, who last
// touched what. The names alone are disclosive, which is why removing a
// library really removes what we hold about it.
// -------------------------------------------------------------------
export default async function SharepointPage() {
  const response = await getSharepointDrivesAction();

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
          description="Catalogue a document library so its structure can be reviewed. Nothing in SharePoint is changed."
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
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
