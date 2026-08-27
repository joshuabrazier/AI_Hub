import { describe, expect, it } from "vitest";

import { parseSharepointSiteUrl, SharepointUrlError } from "./site-url";

// -------------------------------------------------------------------
// Splitting a pasted library URL.
//
// THESE TESTS EXIST BECAUSE THE FIRST VERSION SHIPPED A SILENT WRONG
// ANSWER, and the shape of that mistake is worth keeping in front of
// whoever edits this next.
//
// The original code assumed a bad parse would fail loudly: an unreadable
// address would produce a path Graph did not recognise, and Graph would
// answer 404. That was wrong. Anything unreadable fell through to the
// TENANT ROOT site, which resolves perfectly well - so somebody who pasted
// a "Copy link" URL got a real site name and an empty library list, and
// concluded the feature was broken.
//
// So the cases below are not a tidy sample of URL shapes. They are the
// forms SharePoint actually hands people, and the rule is: read the site
// out of it, or say plainly that we could not. Never quietly answer a
// different question.
// -------------------------------------------------------------------

describe("parseSharepointSiteUrl - address bar URLs", () => {
  it("reads a site from the bare site address", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/sites/Finance")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Finance",
      isTenantRoot: false,
    });
  });

  it("discards everything below the site", () => {
    // What an admin copies from the browser bar is a view of a library,
    // several segments deep. The library is chosen from what Graph lists
    // for the site, so none of this tail is wanted.
    expect(
      parseSharepointSiteUrl(
        "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/Forms/AllItems.aspx",
      ),
    ).toEqual({ hostname: "contoso.sharepoint.com", sitePath: "/sites/Finance", isTenantRoot: false });
  });

  it("handles the teams managed path as well as sites", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/teams/Marketing/Shared Documents")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/teams/Marketing",
      isTenantRoot: false,
    });
  });

  it("decodes an encoded site name", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/sites/People%20and%20Culture")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/People and Culture",
      isTenantRoot: false,
    });
  });

  it("ignores the case of the managed path", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/Sites/Finance").sitePath).toBe("/Sites/Finance");
  });

  it("keeps a government or non-standard tenant host", () => {
    // SharePoint is not only *.sharepoint.com. Rejecting anything else would
    // lock out a whole class of tenant to guard against nothing: the host
    // only ever becomes part of a path on graph.microsoft.com.
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.us/sites/Finance").hostname).toBe(
      "contoso.sharepoint.us",
    );
  });
});

// -------------------------------------------------------------------
// THE REGRESSION. These are what the "Copy link" button produces, and
// every one of them used to resolve to the tenant root.
// -------------------------------------------------------------------
describe("parseSharepointSiteUrl - sharing links", () => {
  it("reads a site out of a folder share link", () => {
    // /:f:/s/Finance/... - s stands in for sites. This is the exact shape
    // that sent somebody to an empty root site.
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/:f:/s/Finance/EqX7abc123?e=5tGhQz")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Finance",
      isTenantRoot: false,
    });
  });

  it("reads a team site out of a share link", () => {
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/:b:/t/Marketing/EqX7abc?e=1")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/teams/Marketing",
      isTenantRoot: false,
    });
  });

  it("follows the redirect form, where the real path comes after /r/", () => {
    expect(
      parseSharepointSiteUrl("https://contoso.sharepoint.com/:w:/r/sites/Finance/Shared%20Documents/x.docx"),
    ).toEqual({ hostname: "contoso.sharepoint.com", sitePath: "/sites/Finance", isTenantRoot: false });
  });

  it("handles every file-type marker, not just folders", () => {
    for (const marker of [":f:", ":w:", ":x:", ":p:", ":b:", ":o:", ":v:"]) {
      expect(
        parseSharepointSiteUrl(`https://contoso.sharepoint.com/${marker}/s/Finance/EqX?e=1`).sitePath,
      ).toBe("/sites/Finance");
    }
  });

  it("refuses a personal OneDrive link by name", () => {
    // A personal drive is not a site and has no libraries to nominate.
    // Resolving it to the tenant root would be the old silent wrong answer.
    expect(() =>
      parseSharepointSiteUrl("https://contoso.sharepoint.com/:x:/g/personal/someone_contoso_com/EqX?e=1"),
    ).toThrow(SharepointUrlError);
  });

  it("refuses a sharing form it does not recognise, rather than falling back to root", () => {
    expect(() => parseSharepointSiteUrl("https://contoso.sharepoint.com/:f:/zz/Finance/EqX")).toThrow(
      SharepointUrlError,
    );
  });
});

describe("parseSharepointSiteUrl - the tenant root", () => {
  it("is reported as the root rather than passed off as the pasted site", () => {
    // A root-hosted library is legitimate, so this is not an error - but the
    // flag has to travel, because the root RESOLVES and would otherwise look
    // like the site the person asked for.
    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "",
      isTenantRoot: true,
    });

    expect(parseSharepointSiteUrl("https://contoso.sharepoint.com/Shared Documents")).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "",
      isTenantRoot: true,
    });
  });
});

describe("parseSharepointSiteUrl - rejections", () => {
  it("refuses anything that is not an https address", () => {
    expect(() => parseSharepointSiteUrl("http://contoso.sharepoint.com/sites/Finance")).toThrow(
      SharepointUrlError,
    );
    expect(() => parseSharepointSiteUrl("contoso.sharepoint.com/sites/Finance")).toThrow(SharepointUrlError);
    expect(() => parseSharepointSiteUrl("   ")).toThrow(SharepointUrlError);
  });
});
