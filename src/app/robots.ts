import type { MetadataRoute } from "next";

import { envClient } from "@/lib/env-client";
import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// Served at /robots.txt (Next generates it from this).
//
// Crawlers may index the public pages, but not the three authenticated areas,
// the API, or the auth screens.
//
// The disallow list is derived from ROUTES rather than written out by hand.
// The previous version listed "/client", a route that no longer exists, and
// adding the new manager area would have been a step somebody had to remember.
// Deriving it means a new area is covered as soon as its route constant is.
// -------------------------------------------------------------------
export default function robots(): MetadataRoute.Robots {
  const base = envClient.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        ROUTES.ADMIN,
        ROUTES.MANAGE,
        ROUTES.PORTAL,
        "/api",
        ROUTES.SETTINGS,
        ROUTES.PUBLIC_AUTH_SIGN_IN,
        ROUTES.PUBLIC_AUTH_TWO_FACTOR,
        ROUTES.SETUP_TWO_FACTOR,
        ROUTES.PUBLIC_AUTH_FORGOT_PASSWORD,
        ROUTES.PUBLIC_AUTH_RESET_PASSWORD,
        "/accept-invite",
        ROUTES.ERROR_FORBIDDEN,
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
