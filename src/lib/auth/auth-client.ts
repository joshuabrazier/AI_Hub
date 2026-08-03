import { createAuthClient } from "better-auth/react";
import { envClient } from "../../lib/env-client";
import { adminClient, inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { auth } from "./auth";
import { accessControl, impersonatorOnly } from "./auth-permissions";
import { USER_ROLES } from "../data/kysely-database-types";

// -------------------------------------------------------------------
// Better Auth Client - used in client components
// -------------------------------------------------------------------
export const authClient = createAuthClient({
  // Talk to the origin the app is actually served from (localhost, a LAN IP, or
  // a Cloudflare tunnel) instead of a fixed URL. This keeps auth requests
  // same-origin - so they work over a tunnel and the session cookie is set on
  // the page's own domain rather than localhost. Falls back to the configured
  // URL during SSR (auth calls only ever run in the browser).
  baseURL: typeof window !== "undefined" ? window.location.origin : envClient.NEXT_PUBLIC_APP_URL,
  // adminClient powers admin "impersonate as client" (view the client portal
  // as a selected client) and stop-impersonating.
  plugins: [
    inferAdditionalFields<typeof auth>(),
    adminClient({
      ac: accessControl,
      roles: {
        [USER_ROLES.ADMIN]: impersonatorOnly,
      },
    }),
    // Adds authClient.twoFactor.{enable,disable,verifyTotp}. Sign-in returns
    // `twoFactorRedirect` when 2FA is required; the sign-in page routes to the
    // verification step itself (no auto-redirect configured here).
    twoFactorClient(),
  ],
});
