import { describe, expect, it } from "vitest";

import { SITE_CONTENT_KEYS } from "@/lib/data/kysely-database-types";

import {
  LANDING_CONTENT_KEYS,
  RICH_TEXT_CONTENT_KEYS,
  STRUCTURED_CONTENT_KEYS,
  UpdateContactDetailsSchema,
  UpdateLandingBlockSchema,
  UpdateSiteContentSchema,
} from "./admin-content.types";

// -------------------------------------------------------------------
// These schemas are the gate between the admin editor and what the public
// site renders. A value that gets past them but fails on read falls back to
// the shipped default, which looks from the admin's side like the save did
// nothing - so the cases that must be REFUSED are the point of this file.
// -------------------------------------------------------------------

describe("editable content keys", () => {
  it("sends every key to exactly one editor", () => {
    const covered = [...RICH_TEXT_CONTENT_KEYS, ...STRUCTURED_CONTENT_KEYS, ...LANDING_CONTENT_KEYS];
    const allKeys = Object.values(SITE_CONTENT_KEYS);

    expect([...covered].sort()).toEqual([...allKeys].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });
});

describe("UpdateSiteContentSchema", () => {
  it("accepts a rich-text page", () => {
    expect(
      UpdateSiteContentSchema.safeParse({ contentName: SITE_CONTENT_KEYS.ABOUT, contentValue: "<p>Hello</p>" })
        .success,
    ).toBe(true);
  });

  it("refuses a structured key, which has its own validated form", () => {
    expect(
      UpdateSiteContentSchema.safeParse({ contentName: SITE_CONTENT_KEYS.LANDING_HERO, contentValue: "<p>x</p>" })
        .success,
    ).toBe(false);
    expect(
      UpdateSiteContentSchema.safeParse({ contentName: SITE_CONTENT_KEYS.CONTACT, contentValue: "<p>x</p>" }).success,
    ).toBe(false);
  });
});

describe("UpdateLandingBlockSchema", () => {
  // The union is hand-listed, because a discriminated union needs literal
  // members - so nothing in the type system stops a fifth landing_* key from
  // shipping with an editor and no way to save it. This is that check.
  it("has a save path for every landing key", () => {
    const savableKeys = UpdateLandingBlockSchema.options.map((option) => option.shape.contentName.value);

    expect([...savableKeys].sort()).toEqual([...LANDING_CONTENT_KEYS].sort());
  });

  it("trims and fills the optional copy the page treats as optional", () => {
    const result = UpdateLandingBlockSchema.safeParse({
      contentName: SITE_CONTENT_KEYS.LANDING_HERO,
      value: { heading: "  Everything in one place  ", primaryCta: { label: "Go", href: "/contact" } },
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.contentName === SITE_CONTENT_KEYS.LANDING_HERO) {
      expect(result.data.value.heading).toBe("Everything in one place");
      expect(result.data.value.eyebrow).toBe("");
    }
  });

  it("refuses an off-site link, which the home page must not become a door to", () => {
    expect(
      UpdateLandingBlockSchema.safeParse({
        contentName: SITE_CONTENT_KEYS.LANDING_HERO,
        value: { heading: "Hi", primaryCta: { label: "Go", href: "https://elsewhere.example" } },
      }).success,
    ).toBe(false);
  });

  it("refuses an icon outside the closed map", () => {
    expect(
      UpdateLandingBlockSchema.safeParse({
        contentName: SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS,
        value: [{ icon: "not-an-icon", title: "Secure" }],
      }).success,
    ).toBe(false);
  });

  it("refuses more rows than the page lays out", () => {
    expect(
      UpdateLandingBlockSchema.safeParse({
        contentName: SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS,
        value: Array.from({ length: 7 }, () => ({ icon: "shield", title: "Secure" })),
      }).success,
    ).toBe(false);
  });

  it("refuses a block with no heading", () => {
    expect(
      UpdateLandingBlockSchema.safeParse({
        contentName: SITE_CONTENT_KEYS.LANDING_CTA,
        value: { heading: "   ", cta: { label: "Go", href: "/contact" } },
      }).success,
    ).toBe(false);
  });
});

describe("UpdateContactDetailsSchema", () => {
  it("refuses an invalid delivery address for public enquiries", () => {
    expect(UpdateContactDetailsSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("accepts an email on its own", () => {
    const result = UpdateContactDetailsSchema.safeParse({ email: "hello@example.com" });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("");
  });
});
