import "server-only";

import { getSiteContentByKeyRepo, getSiteContentByKeysRepo } from "@/lib/data/repositories/site-content.repository";
import { SITE_CONTENT_KEYS, type SiteContentKey } from "@/lib/data/kysely-database-types";
import { handleError } from "@/lib/handle-errors";

import { parseContactDetails, type ContactDetails } from "./contact-content";
import {
  landingCtaSchema,
  landingFeaturesSchema,
  landingHeroSchema,
  landingHighlightsSchema,
  parseLandingBlock,
  type LandingContent,
} from "./landing-content.types";
import {
  DEFAULT_LANDING_CTA,
  DEFAULT_LANDING_FEATURES,
  DEFAULT_LANDING_HERO,
  DEFAULT_LANDING_HIGHLIGHTS,
  SITE_CONTENT_DEFAULTS,
} from "./site-content-defaults";

// -------------------------------------------------------------------
// The rich-text content for a public page. Falls back to the built-in copy
// when the stored value is empty, so a page never renders blank.
//
// The value is admin-authored HTML: it is sanitised on the way IN, and callers
// sanitise again before rendering with dangerouslySetInnerHTML. The second
// pass covers rows written before a sanitiser rule changed.
// -------------------------------------------------------------------
export async function getPageContent(key: SiteContentKey): Promise<string> {
  try {
    const row = await getSiteContentByKeyRepo(key);
    const value = row?.contentValue?.trim();
    return value ? value : SITE_CONTENT_DEFAULTS[key];
  } catch (error) {
    throw handleError("getPageContent", error);
  }
}

// -------------------------------------------------------------------
// The structured contact details shown on the Contact page. The email here is
// also where public enquiries are delivered.
// -------------------------------------------------------------------
export async function getContactDetails(): Promise<ContactDetails> {
  try {
    const row = await getSiteContentByKeyRepo(SITE_CONTENT_KEYS.CONTACT);
    const value = row?.contentValue?.trim();
    return parseContactDetails(value ? value : SITE_CONTENT_DEFAULTS[SITE_CONTENT_KEYS.CONTACT]);
  } catch (error) {
    throw handleError("getContactDetails", error);
  }
}

const LANDING_KEYS: SiteContentKey[] = [
  SITE_CONTENT_KEYS.LANDING_HERO,
  SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS,
  SITE_CONTENT_KEYS.LANDING_FEATURES,
  SITE_CONTENT_KEYS.LANDING_CTA,
];

export type LandingContentResult = LandingContent & {
  /** Keys whose stored value failed validation and fell back to the default. */
  invalidKeys: SiteContentKey[];
};

// -------------------------------------------------------------------
// Everything the public home page renders, in one round trip.
//
// Each block is validated against its schema. A block that fails degrades to
// the shipped default rather than throwing, because one malformed row must not
// be able to take the public site down. The keys that fell back are returned
// so the admin editor can say so plainly, instead of leaving someone to wonder
// why their edit had no effect.
// -------------------------------------------------------------------
export async function getLandingContent(): Promise<LandingContentResult> {
  try {
    const rows = await getSiteContentByKeysRepo(LANDING_KEYS);
    const byKey = new Map(rows.map((row) => [row.contentName, row.contentValue ?? ""]));
    const invalidKeys: SiteContentKey[] = [];

    const hero = parseLandingBlock(
      landingHeroSchema,
      byKey.get(SITE_CONTENT_KEYS.LANDING_HERO) ?? "",
      DEFAULT_LANDING_HERO,
    );
    if (hero.usedFallback) invalidKeys.push(SITE_CONTENT_KEYS.LANDING_HERO);

    const highlights = parseLandingBlock(
      landingHighlightsSchema,
      byKey.get(SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS) ?? "",
      DEFAULT_LANDING_HIGHLIGHTS,
    );
    if (highlights.usedFallback) invalidKeys.push(SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS);

    const features = parseLandingBlock(
      landingFeaturesSchema,
      byKey.get(SITE_CONTENT_KEYS.LANDING_FEATURES) ?? "",
      DEFAULT_LANDING_FEATURES,
    );
    if (features.usedFallback) invalidKeys.push(SITE_CONTENT_KEYS.LANDING_FEATURES);

    const cta = parseLandingBlock(
      landingCtaSchema,
      byKey.get(SITE_CONTENT_KEYS.LANDING_CTA) ?? "",
      DEFAULT_LANDING_CTA,
    );
    if (cta.usedFallback) invalidKeys.push(SITE_CONTENT_KEYS.LANDING_CTA);

    return {
      hero: hero.value,
      highlights: highlights.value,
      features: features.value,
      cta: cta.value,
      invalidKeys,
    };
  } catch (error) {
    throw handleError("getLandingContent", error);
  }
}
