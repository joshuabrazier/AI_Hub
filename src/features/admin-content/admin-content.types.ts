import z from "zod";

import { contactDetailsSchema, type ContactDetails } from "@/features/site-content/contact-content";
import {
  landingCtaSchema,
  landingFeaturesSchema,
  landingHeroSchema,
  landingHighlightsSchema,
  type LandingCta,
  type LandingFeatures,
  type LandingHero,
  type LandingHighlights,
} from "@/features/site-content/landing-content.types";
import { SITE_CONTENT_KEYS, SITE_CONTENT_SHAPES, type SiteContentKey } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Friendly labels for every editable piece of content.
// -------------------------------------------------------------------
export const SITE_CONTENT_LABELS: Record<SiteContentKey, string> = {
  [SITE_CONTENT_KEYS.ABOUT]: "About",
  [SITE_CONTENT_KEYS.CONTACT]: "Contact details",
  [SITE_CONTENT_KEYS.PRIVACY_POLICY]: "Privacy Policy",
  [SITE_CONTENT_KEYS.TERMS_AND_CONDITIONS]: "Terms and Conditions",
  [SITE_CONTENT_KEYS.LANDING_HERO]: "Home page: hero",
  [SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS]: "Home page: highlights",
  [SITE_CONTENT_KEYS.LANDING_FEATURES]: "Home page: features",
  [SITE_CONTENT_KEYS.LANDING_CTA]: "Home page: closing call to action",
};

// -------------------------------------------------------------------
// Which keys each admin screen owns.
//
// The Site Content screen edits the long-form pages with the rich-text editor.
// The Home page screen edits the structured landing blocks with real form
// fields, because hand-editing JSON is not an interface.
//
// The three sets below are DERIVED from SITE_CONTENT_SHAPES rather than listed
// by hand, so no key can be left out of every set. That omission is exactly how
// the contact details became stored but unreachable, leaving public enquiries
// going to an address nobody could change without direct SQL.
//
// Being in a set is not the same as being editable, and only the rich-text set
// gets that for free: the Site Content screen renders one card per key in it. A
// landing_* key also needs a variant in UpdateLandingBlockSchema below, a field
// on LandingContentResponseDTO, and a form of its own in home-page-editor.tsx,
// because no generic form can know the shape of a block it has never seen. The
// save path is the part that can be checked, and it is - a landing key with no
// variant fails a case in admin-content.types.test.ts.
// -------------------------------------------------------------------
const ALL_KEYS = Object.values(SITE_CONTENT_KEYS) as SiteContentKey[];

// The same three sets at the type level, so a DTO can say which keys it carries
// and a schema map can be checked for completeness when it compiles.
export type RichTextContentKey = {
  [K in SiteContentKey]: (typeof SITE_CONTENT_SHAPES)[K] extends "html" ? K : never;
}[SiteContentKey];

export type LandingContentKey = Extract<SiteContentKey, `landing_${string}`>;

export type StructuredContentKey = Exclude<SiteContentKey, RichTextContentKey | LandingContentKey>;

export function isLandingContentKey(key: SiteContentKey): key is LandingContentKey {
  return key.startsWith("landing_");
}

function isRichTextContentKey(key: SiteContentKey): key is RichTextContentKey {
  return SITE_CONTENT_SHAPES[key] === "html";
}

function isStructuredContentKey(key: SiteContentKey): key is StructuredContentKey {
  return SITE_CONTENT_SHAPES[key] === "json" && !isLandingContentKey(key);
}

export const RICH_TEXT_CONTENT_KEYS = ALL_KEYS.filter(isRichTextContentKey);

export const LANDING_CONTENT_KEYS = ALL_KEYS.filter(isLandingContentKey);

export const STRUCTURED_CONTENT_KEYS = ALL_KEYS.filter(isStructuredContentKey);

// -------------------------------------------------------------------
// DTOs
// -------------------------------------------------------------------

/**
 * One rich-text page as the Site Content screen edits it. Also what a save
 * returns, so the editor can hold the STORED value as its baseline: the value
 * is sanitised on write, and treating the submitted text as saved would leave
 * the card claiming no unsaved changes while showing markup the row does not
 * contain.
 */
export type SiteContentResponseDTO = {
  contentName: RichTextContentKey;
  contentValue: string;
  updatedAt: string;
};

/**
 * The structured contact block. `updatedAt` is empty until its first save.
 *
 * `isIgnored` means the stored row could not be read, so the site fell back to
 * the shipped default - including the address public enquiries are delivered
 * to. The editor surfaces that and lets the default be saved back over the
 * unreadable value.
 */
export type ContactDetailsResponseDTO = {
  details: ContactDetails;
  updatedAt: string;
  isIgnored: boolean;
};

/** Everything the Site Content screen edits: the pages, plus contact. */
export type SiteContentEditorDTO = {
  pages: SiteContentResponseDTO[];
  contact: ContactDetailsResponseDTO;
};

/**
 * Everything the Home page screen edits. `invalidKeys` are the blocks whose
 * stored value failed validation, so the public page is showing the shipped
 * default instead - the editor says so rather than leaving someone to wonder
 * why their edit had no effect.
 */
export type LandingContentResponseDTO = {
  hero: LandingHero;
  highlights: LandingHighlights;
  features: LandingFeatures;
  cta: LandingCta;
  invalidKeys: LandingContentKey[];
};

// -------------------------------------------------------------------
// Save schemas
//
// The rich-text save accepts only the HTML keys. It deliberately does NOT
// validate - or even accept - a JSON key: those go through the typed schemas
// below, which check the block against the SAME schema the public page reads
// with. Saving unvalidated JSON here is what would let an admin store a value
// the page then silently ignores in favour of the default.
// -------------------------------------------------------------------
const RICH_TEXT_KEY_VALUES = RICH_TEXT_CONTENT_KEYS as [RichTextContentKey, ...RichTextContentKey[]];

export const UpdateSiteContentSchema = z.object({
  contentName: z.enum(RICH_TEXT_KEY_VALUES),
  contentValue: z.string().max(50000),
});

export type UpdateSiteContentRequestDTO = z.infer<typeof UpdateSiteContentSchema>;

// Each landing block and the schema it is validated with. There is no second
// set of rules here: these are the schemas the public home page reads through,
// so anything that saves is renderable by construction.
//
// `satisfies` makes the map exhaustive - add a landing_* key without giving it
// a schema and this stops compiling, instead of the key quietly becoming
// uneditable. It is deliberately module-private: the union below is the only
// way in, so a caller cannot pick a schema and a key that do not match.
const LANDING_BLOCK_SCHEMAS = {
  [SITE_CONTENT_KEYS.LANDING_HERO]: landingHeroSchema,
  [SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS]: landingHighlightsSchema,
  [SITE_CONTENT_KEYS.LANDING_FEATURES]: landingFeaturesSchema,
  [SITE_CONTENT_KEYS.LANDING_CTA]: landingCtaSchema,
} as const satisfies Record<LandingContentKey, z.ZodType>;

// Hand-listed because a discriminated union needs literal members: that is what
// makes `contentName` narrow `value` to the matching block. The cost is that a
// new landing_* key could compile with no save path at all, so
// admin-content.types.test.ts checks this union against LANDING_CONTENT_KEYS.
export const UpdateLandingBlockSchema = z.discriminatedUnion("contentName", [
  z.object({
    contentName: z.literal(SITE_CONTENT_KEYS.LANDING_HERO),
    value: LANDING_BLOCK_SCHEMAS[SITE_CONTENT_KEYS.LANDING_HERO],
  }),
  z.object({
    contentName: z.literal(SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS),
    value: LANDING_BLOCK_SCHEMAS[SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS],
  }),
  z.object({
    contentName: z.literal(SITE_CONTENT_KEYS.LANDING_FEATURES),
    value: LANDING_BLOCK_SCHEMAS[SITE_CONTENT_KEYS.LANDING_FEATURES],
  }),
  z.object({
    contentName: z.literal(SITE_CONTENT_KEYS.LANDING_CTA),
    value: LANDING_BLOCK_SCHEMAS[SITE_CONTENT_KEYS.LANDING_CTA],
  }),
]);

export type UpdateLandingBlockRequestDTO = z.infer<typeof UpdateLandingBlockSchema>;

// The contact block, validated with the same schema the site reads it back
// through. The email in here is where public enquiries are delivered, so a
// value that fails to parse would silently redirect them to the default.
export const UpdateContactDetailsSchema = contactDetailsSchema;

export type UpdateContactDetailsRequestDTO = z.infer<typeof UpdateContactDetailsSchema>;
