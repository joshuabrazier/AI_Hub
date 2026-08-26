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

export interface SharepointSiteAddress {
  // The tenant host, eg "contoso.sharepoint.com".
  hostname: string;
  // The server-relative site path, eg "/sites/Finance". EMPTY STRING for
  // the tenant root site, which is a real address and not a failure - see
  // fetchSite for how the two are spelled differently to Graph.
  sitePath: string;
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

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  // The tenant root site. A legitimate address, and the caller has to be
  // able to tell it apart from a failure, which is why this returns an
  // empty path rather than throwing or guessing a default.
  if (segments.length < 2 || !MANAGED_PATHS.includes(segments[0].toLowerCase())) {
    return { hostname: url.hostname, sitePath: "" };
  }

  return { hostname: url.hostname, sitePath: `/${segments[0]}/${segments[1]}` };
}
