import { describe, expect, it } from "vitest";

import { landingHeroSchema } from "./landing-content.types";

const hero = (imageUrl: string) => ({
  heading: "A heading",
  primaryCta: { label: "Go", href: "/contact" },
  imageUrl,
});

describe("hero image path", () => {
  it.each(["/hero.jpg", "/images/hero.webp", "/a/b/c.avif", ""])("accepts the local path %s", (path) => {
    expect(landingHeroSchema.safeParse(hero(path)).success).toBe(true);
  });

  // The point of the check is that admin-entered content cannot point the home
  // page at another host: that would leak every visitor's IP to it and let the
  // image be swapped later without touching this system.
  it.each([
    "https://evil.example.com/x.jpg",
    // Protocol-relative. A browser resolves this to https://evil.example.com/x.jpg
    // even though it looks like a local path, which is the easy one to miss.
    "//evil.example.com/x.jpg",
    "///evil.example.com/x.jpg",
    // Escaping /public.
    "/../../secret.png",
    // Not a path at all.
    "hero.jpg",
    "javascript:alert(1)",
    // Not an image.
    "/hero.js",
  ])("rejects %s", (path) => {
    expect(landingHeroSchema.safeParse(hero(path)).success).toBe(false);
  });
});
