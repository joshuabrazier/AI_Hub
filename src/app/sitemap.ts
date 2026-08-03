import type { MetadataRoute } from "next";

import { envClient } from "@/lib/env-client";
import { ROUTES } from "@/lib/routes";

// Served at /sitemap.xml (Next generates it from this). Lists only the public,
// indexable pages; the three authenticated areas (/admin, /manage, /portal),
// the API and the auth screens are deliberately excluded, and blocked in
// robots.ts as well.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = envClient.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  const publicPaths = [
    ROUTES.PUBLIC_HOME,
    ROUTES.PUBLIC_ABOUT,
    ROUTES.PUBLIC_CONTACT,
    ROUTES.PUBLIC_PRIVACY_POLICY,
    ROUTES.PUBLIC_TERMS_AND_CONDITIONS,
  ];

  return publicPaths.map((path) => ({
    // Home is the bare origin; the rest append their path.
    url: `${base}${path === ROUTES.PUBLIC_HOME ? "" : path}`,
    changeFrequency: "monthly",
    priority: path === ROUTES.PUBLIC_HOME ? 1 : 0.7,
  }));
}
