import type { MetadataRoute } from "next";

import { BRAND, BRAND_COLORS } from "@/lib/brand";

// -------------------------------------------------------------------
// Web app manifest (served at /manifest.webmanifest; Next auto-links it).
// Drives the "Add to home screen" install on Android and Chrome, including
// the icon, so it shows the product logo rather than a generated letter.
// iOS uses the apple-touch-icon in the root layout's metadata instead.
//
// theme_color comes from BRAND_COLORS, which mirrors --primary in globals.css.
// It tints the browser chrome around an installed app, and a stale value is a
// visible seam that nothing warns you about.
// -------------------------------------------------------------------
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND_COLORS.primary,
    icons: [
      // The logo is 447x447; the declared sizes let Chrome treat it as
      // installable and scale it for each slot.
      { src: "/logo.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
