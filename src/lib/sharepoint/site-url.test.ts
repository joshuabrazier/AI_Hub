import { describe, expect, it } from "vitest";

import { parseSharepointSiteUrl, SharepointUrlError } from "./site-url";

// -------------------------------------------------------------------
// Splitting a pasted library URL.
//
// The failure mode here is mild by design - a bad split produces a site
// path Graph does not recognise, so it 404s rather than resolving the
// wrong library. These tests are about the ordinary shapes an admin will
// actually paste, and about the root site staying distinguishable from a
// parse that gave up.
// -------------------------------------------------------------------

describe("parseSharepointSiteUrl", () => {
  it("reads a site from the bare site address", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/sites/Finance")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Finance",
    });
  });

  it("discards everything below the site", () => {
    // What an admin actually copies is a view of a library, several
    // segments deep. The library is chosen from what Graph lists for the
    // site, so none of this tail is wanted.
    expect(
      parseSharepointSiteUrl(
        "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/Forms/AllItems.aspx",
      ),
    ).toEqual({ hostname: "contoso.sharepoint.com", sitePath: "/sites/Finance" });
  });

  it("handles the teams managed path as well as sites", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/teams/Marketing/Shared Documents")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/teams/Marketing",
    });
  });

  it("decodes an encoded site name", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/sites/People%20and%20Culture")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/People and Culture",
    });
  });

  it("treats the tenant root as a real address, not a failure", () => {
    // An EMPTY path is the root site and has its own Graph spelling. If
    // this threw, a tenant that keeps its documents at the root could
    // never be nominated at all.
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "",
    });

    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/Shared Documents")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "",
    });
  });

  it("ignores the case of the managed path", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/Sites/Finance").sitePath).toBe("/Sites/Finance");
  });

  it("keeps a government or non-standard tenant host rather than insisting on sharepoint.com", () => {
    // SharePoint is not only *.sharepoint.com. Rejecting anything else
    // would lock out a whole class of tenant to guard against nothing:
    // the host only ever becomes part of a path on graph.microsoft.com,
    // which is the one place every request goes regardless.
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.us/sites/Finance").hostname).toBe(
      "contoso.sharepoint.us",
    );
  });

  it("refuses anything that is not an https address", () => {
    expect(() => parseSharepointSiteUrl("http://contoso.sharepoint.com/sites/Finance")).toThrow(
      SharepointUrlError,
    );
    expect(() => parseSharepointSiteUrl("contoso.sharepoint.com/sites/Finance")).toThrow(SharepointUrlError);
    expect(() => parseSharepointSiteUrl("   ")).toThrow(SharepointUrlError);
  });
});
