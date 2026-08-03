import { envClient } from "@/lib/env-client";

// -------------------------------------------------------------------
// Brand
//
// The single source of truth for who this deployment says it is. Every
// surface that shows the product's name reads it from here: the root layout
// metadata, the web manifest, the logo wordmark, the public footer, the auth
// shell and every email template.
//
// To rebrand a project built on this base: set NEXT_PUBLIC_APP_TITLE and
// NEXT_PUBLIC_APP_DESCRIPTION in the environment, adjust the copy below, and
// swap the palette in globals.css. Nothing else should need editing.
//
// Name and description come from the environment rather than being hardcoded
// because they are baked into the client bundle at build time and differ per
// deployment (see .github/workflows/deploy.yml).
//
// WARNING: NEXT_PUBLIC_APP_TITLE is also the TOTP issuer
// (src/lib/auth/auth.ts). Changing its value on a live environment relabels
// the entry in every already-enrolled authenticator app. Existing secrets keep
// verifying, but users will see a stale or duplicated entry. Choose it once.
// -------------------------------------------------------------------

export const BRAND = {
  /** Product name. Shown wherever the app names itself. */
  name: envClient.NEXT_PUBLIC_APP_TITLE,

  /** One-line description, used for metadata and the manifest. */
  description: envClient.NEXT_PUBLIC_APP_DESCRIPTION,

  /**
   * Short label for constrained spots: the logo's secondary line, the browser
   * home-screen title, the email header. Kept separate from `name` so a long
   * product name does not overflow them.
   */
  shortName: "Portal",

  /** The legal entity named in the footer copyright and in legal page copy. */
  legalName: "Data Sagacity",
} as const;

// -------------------------------------------------------------------
// Brand colours for the places that CANNOT read the CSS tokens.
//
// The app itself styles entirely through the custom properties in
// globals.css, and nothing in src/app or src/features should reference a
// hex. But two consumers are outside the stylesheet's reach:
//
//   - the web manifest, which tints the browser chrome around an installed app
//   - the email templates, since mail clients do not support CSS variables
//
// So there are exactly two places a brand colour is written down: the
// `--primary` token in globals.css, and this object. THEY MUST MATCH -
// there is no build step that checks it, and a mismatch shows up as a
// browser chrome or an email header in the old colour, with nothing failing.
// -------------------------------------------------------------------
export const BRAND_COLORS = {
  /** Must equal the light-theme `--primary` in src/app/globals.css. */
  primary: "#1b7789",
  /** Must equal the light-theme `--muted`. */
  surface: "#f6fafb",
  line: "#dde7e9",
  ink: "#0f1a1c",
  muted: "#566a6e",
  white: "#ffffff",
} as const;

// -------------------------------------------------------------------
// The copyright line shown in the public footer, the auth shell and the
// email footer. Computed from the current year at render time so it never
// goes stale, and centralised so all three agree.
// -------------------------------------------------------------------
export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${BRAND.legalName}. All rights reserved.`;
}
