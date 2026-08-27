"use client";

import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { findSharepointLibrariesAction, nominateSharepointLibraryAction } from "../sharepoint.actions";
import type { SharepointSiteLookup } from "../sharepoint.types";

// -------------------------------------------------------------------
// Nominating a library, in two steps.
//
// TWO STEPS BECAUSE THE FIRST IS FREE AND THE SECOND IS NOT. Looking up a
// site writes nothing, so an admin can paste, see what is there, and change
// their mind. Only choosing a library adds a row.
//
// The address is what somebody has in their address bar. It is deliberately
// not a drive id: those look like "b!x7Kd..." and nobody has one to hand.
// -------------------------------------------------------------------
export function NominateLibraryForm() {
  const [siteUrl, setSiteUrl] = useState("");
  const [lookup, setLookup] = useState<SharepointSiteLookup | null>(null);
  // The URL the lookup was FOR, kept separately from the input. Nominating
  // re-resolves the site server-side, and doing that against a URL the
  // admin has since edited would resolve a different site from the list
  // they are looking at.
  const [lookedUpUrl, setLookedUpUrl] = useState("");
  const [isFinding, startFinding] = useTransition();
  const [isNominating, startNominating] = useTransition();

  function onFind() {
    startFinding(async () => {
      try {
        const response = await findSharepointLibrariesAction({ siteUrl });

        if (!response.success) {
          toast.error(response.formError ?? "That site could not be read.");
          return;
        }

        setLookup(response.data);
        setLookedUpUrl(siteUrl);

        if (response.data.libraries.length === 0) {
          toast.info("That site has no document libraries you can read.");
        }
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  }

  function onNominate(driveId: string, name: string) {
    startNominating(async () => {
      try {
        const response = await nominateSharepointLibraryAction({ siteUrl: lookedUpUrl, driveId });

        if (!response.success) {
          toast.error(response.formError ?? "That library could not be added.");
          return;
        }

        toast.success(`${name} is now being catalogued.`);
        setLookup(null);
        setSiteUrl("");
        setLookedUpUrl("");
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  }

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Add a document library</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste the address of a SharePoint site. Only libraries you can open yourself will be listed, and a crawl
        can never see more than you can.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="sharepoint-site-url">Site address</Label>
          <Input
            id="sharepoint-site-url"
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.target.value)}
            placeholder="https://contoso.sharepoint.com/sites/Finance"
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5"
          />
        </div>

        <Button type="button" onClick={onFind} disabled={isFinding || siteUrl.trim().length === 0}>
          {isFinding ? (
            <Loader2 size={16} aria-hidden="true" className="animate-spin" />
          ) : (
            <Search size={16} aria-hidden="true" />
          )}
          Find libraries
        </Button>
      </div>

      {lookup ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">{lookup.siteName}</p>

          {/* The tenant root resolves, so without saying this a person who
              pasted a "Copy link" URL sees a real site name and an empty
              list, and concludes the feature is broken rather than that we
              read their address wrongly. */}
          {lookup.isTenantRoot ? (
            <div
              role="status"
              className="mt-3 rounded-lg border border-data-caution/40 bg-data-caution-surface p-3 text-sm text-data-caution-text"
            >
              <p className="font-semibold">This is your tenant root site, not the one in that address.</p>
              <p className="mt-0.5">
                No site name could be read from what you pasted, so the root site was used instead. Open the
                library in SharePoint and copy the address from the browser bar - it should contain
                <span className="font-mono"> /sites/ </span>
                or
                <span className="font-mono"> /teams/</span>.
              </p>
            </div>
          ) : null}

          {lookup.libraries.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No document libraries on this site. If you were expecting one, check that you can open it in
              SharePoint yourself.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {lookup.libraries.map((library) => (
                <li key={library.driveId} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-sm text-foreground">{library.name}</span>

                  {library.alreadyNominated ? (
                    <span className="text-xs text-muted-foreground">Already added</span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isNominating}
                      onClick={() => onNominate(library.driveId, library.name)}
                    >
                      Add
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
