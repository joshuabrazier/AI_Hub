import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// Public site navigation
//
// Structural, so it lives in code rather than in the CMS: these are the pages
// the app actually routes to, and an admin adding a link here could not create
// the page behind it. Page COPY is admin-editable; the map of pages is not.
//
// Placement is an explicit flag per link. The previous version derived the
// header from NAV_LINKS.slice(0, 2), so reordering the array silently moved
// the privacy policy into the header - a positional coupling with no type
// error behind it.
// -------------------------------------------------------------------
export type PublicNavLink = {
  label: string;
  href: string;
  /** Show in the header. Every link shows in the footer. */
  inHeader: boolean;
};

export const PUBLIC_NAV_LINKS: PublicNavLink[] = [
  { label: "About", href: ROUTES.PUBLIC_ABOUT, inHeader: true },
  { label: "Contact", href: ROUTES.PUBLIC_CONTACT, inHeader: true },
  { label: "Privacy", href: ROUTES.PUBLIC_PRIVACY_POLICY, inHeader: false },
  { label: "Terms", href: ROUTES.PUBLIC_TERMS_AND_CONDITIONS, inHeader: false },
];

export const HEADER_NAV_LINKS = PUBLIC_NAV_LINKS.filter((link) => link.inHeader);
