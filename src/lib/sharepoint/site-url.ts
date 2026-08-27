// -------------------------------------------------------------------
// A pasted SharePoint URL, turned into something Graph can look up.
//
// This exists because nobody can produce a Graph drive id by hand. They
// are opaque strings like "b!x7Kd...". What an admin actually has is the
// address bar of the library they are looking at, so that is what the
// nomination form asks for, and this is the piece that makes it usable.
//
// Pure and separate from the client so it can be tested without a network.
//
// ===================================================================
// THE URL LAYOUT IS INFERRED, the Graph lookup it feeds is not
// ===================================================================
// That a site lives at /sites/{name} or /teams/{name}, and that anything
// else is the tenant root site, is the SharePoint Online convention rather
// than a documented API contract. The addressing it produces IS
// documented - see fetchSite in graph-client.ts.
//
// The mitigation is that a wrong split cannot be silent. It produces a
// site path Graph does not recognise, and Graph answers 404, which the
// nomination service reports to the admin as "that library could not be
// found". There is no reading of a bad parse that ends with the wrong
// library being crawled: the path either resolves to the site the admin
// pasted or it resolves to nothing.
// -------------------------------------------------------------------

// The two first segments SharePoint uses for a managed path. Anything else
// is treated as content inside the tenant root site.
const MANAGED_PATHS = ["sites", "teams"];

// -------------------------------------------------------------------
// SHARING LINKS, which is what the "Copy link" button actually produces
// and therefore what people actually paste.
//
// They do not look like an address bar URL at all. The first segment is a
// type marker - :f: for a folder, :w: for Word, :x: for Excel, :b: for a
// PDF and so on - and the SITE is encoded in what follows:
//
//   /:f:/s/Finance/EqX7abc?e=...        s = sites,  so /sites/Finance
//   /:f:/t/Marketing/EqX7abc?e=...      t = teams,  so /teams/Marketing
//   /:w:/r/sites/Finance/a/b.docx       r = the real server-relative path
//   /:x:/g/personal/someone_example/... g = somebody's OneDrive, not a site
//
// This mattered more than it looks. Without it the marker segment failed
// the managed-path check and the whole address fell through to "tenant
// root" - which RESOLVES, to a different and usually empty site. The
// person sees a real site name and an empty library and concludes the
// feature is broken, when what actually happened is that we answered a
// question they did not ask.
// -------------------------------------------------------------------
const SHARING_MARKER = /^:[a-z]:$/i;

const SHARING_SCOPES: Record<string, string> = { s: "sites", t: "teams" };

// OneDrive for Business, reached through the same host. A personal drive is
// not a site and has no document libraries to nominate, so it is refused by
// name rather than resolved into something misleading.
const PERSONAL_SCOPES = new Set(["g", "p", "u"]);

export interface SharepointSiteAddress {
  // The tenant host, eg "contoso.sharepoint.com".
  hostname: string;
  // The server-relative site path, eg "/sites/Finance". EMPTY STRING for
  // the tenant root site, which is a real address and not a failure - see
  // fetchSite for how the two are spelled differently to Graph.
  sitePath: string;
  // Whether we fell back to the tenant root rather than reading a site out
  // of the address.
  //
  // THE CALLER MUST SURFACE THIS. The root site resolves, so a person who
  // pasted an address we could not read gets a real site name and an empty
  // library, and reasonably concludes the feature is broken. Reporting it
  // is what turns a silent wrong answer into a visible one.
  isTenantRoot: boolean;
}

export class SharepointUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharepointUrlError";
  }
}

// -------------------------------------------------------------------
// Split a library URL into a host and a site path.
//
// Everything below the site - "/Shared Documents/Forms/AllItems.aspx" and
// the rest - is DISCARDED on purpose. It names a view of a library, not
// the library itself, and the drive is chosen from the list Graph returns
// for the site. Trying to match the library from the URL would mean
// guessing at a display name that has been localised and URL-encoded,
// where asking Graph gives the real answer.
// -------------------------------------------------------------------
export function parseSharepointSiteUrl(rawUrl: string): SharepointSiteAddress {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    throw new SharepointUrlError("Enter the address of the SharePoint library");
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new SharepointUrlError("That does not look like a web address");
  }

  // https only. An http address to a SharePoint tenant is either a typo or
  // something we should not be following, and there is no version of this
  // that should downgrade the connection.
  if (url.protocol !== "https:") {
    throw new SharepointUrlError("The address must start with https");
  }

  if (!url.hostname) {
    throw new SharepointUrlError("The address has no site in it");
  }

  let segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  // Unwrap a sharing link before anything else, so the rest of this
  // function only ever sees an ordinary server-relative path.
  if (segments.length > 0 && SHARING_MARKER.test(segments[0])) {
    const scope = (segments[1] ?? "").toLowerCase();

    if (PERSONAL_SCOPES.has(scope)) {
      throw new SharepointUrlError(
        "That is a link to somebody's personal OneDrive, not a SharePoint site. Open the site in SharePoint and use its address instead.",
      );
    }

    if (SHARING_SCOPES[scope] && segments[2]) {
      // /:f:/s/Finance/... - the scope letter stands in for the managed path.
      return {
        hostname: url.hostname,
        sitePath: `/${SHARING_SCOPES[scope]}/${segments[2]}`,
        isTenantRoot: false,
      };
    }

    if (scope === "r") {
      // /:w:/r/sites/Finance/... - what follows is the real path, so carry
      // on with it and let the ordinary rules below apply.
      segments = segments.slice(2);
    } else {
      // A marker we do not recognise. Refusing is right: the alternative is
      // the tenant-root fallback below, which resolves to a REAL but
      // different site and reads as "the library is empty".
      throw new SharepointUrlError(
        "That link could not be read as a SharePoint site address. Open the library in SharePoint and copy the address from the browser bar instead.",
      );
    }
  }

  // The tenant root site. A legitimate address, and the caller has to be
  // able to tell it apart from a failure, which is why this returns an
  // empty path rather than throwing or guessing a default.
  //
  // IT IS ALSO THE DANGEROUS ANSWER, because it resolves. Anything that
  // reaches here without a managed path gets the root site, so the caller
  // is told this happened - see isTenantRoot on the result - and the screen
  // says which site it actually resolved.
  if (segments.length < 2 || !MANAGED_PATHS.includes(segments[0].toLowerCase())) {
    return { hostname: url.hostname, sitePath: "", isTenantRoot: true };
  }

  return { hostname: url.hostname, sitePath: `/${segments[0]}/${segments[1]}`, isTenantRoot: false };
}
