import { APIError, betterAuth } from "better-auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SITE_MODES } from "../../lib/constants";
import { envClient } from "../../lib/env-client";
import { database } from "../../lib/data/kysely-database-client";
import { envServer } from "../../lib/env-server";
import { USER_ROLES } from "../../lib/data/kysely-database-types";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { sendPasswordResetEmail, sendTwoFactorOtpEmail, sendVerificationEmail } from "../email/send-email";
import { deleteSessionsByUserIdRepo } from "../data/repositories/sessions.repository";
import { getUserByUserIdRepo } from "../data/repositories/users.repository";
import { accessControl, impersonatorOnly } from "./auth-permissions";
import { recordAuthAuditEvent } from "../audit/auth-audit";
import { AUDIT_ACTIONS } from "../audit/audit-log.types";

// How long an emailed two-factor sign-in code stays valid, in minutes.
const TWO_FACTOR_OTP_PERIOD_MINUTES = 5;

// -------------------------------------------------------------------
// Both loopback spellings of whatever port the app is configured on.
//
// Derived from NEXT_PUBLIC_APP_URL rather than hardcoded, so changing the
// dev port is one edit in .env instead of a hunt through this file. The
// two spellings are not interchangeable to a browser: a cookie set on
// localhost is not sent to 127.0.0.1, so whichever one you type has to be
// a trusted origin or Better Auth rejects the sign-in as cross-origin.
//
// Returns nothing if the URL is unparseable - a bad value should narrow the
// trusted list, never widen it.
// -------------------------------------------------------------------
function loopbackOriginsFor(appUrl: string): string[] {
  try {
    const { port } = new URL(appUrl);
    const suffix = port ? `:${port}` : "";

    return [`http://localhost${suffix}`, `http://127.0.0.1${suffix}`];
  } catch {
    return [];
  }
}

// -------------------------------------------------------------------
// Better Auth Config File
// -------------------------------------------------------------------
export const auth = betterAuth({
  // -------------------------------------------------------------------
  // General Settings
  // -------------------------------------------------------------------
  baseURL: envClient.NEXT_PUBLIC_APP_URL,
  database: {
    db: database,
    type: "postgres",
  },

  // -------------------------------------------------------------------
  // Trusted origins (CSRF / cross-origin auth guard)
  // Production trusts only the app's own URL. In development we also trust
  // localhost / 127.0.0.1 and the LAN + Cloudflare-tunnel origins used for
  // phone / HTTPS testing (mirrors next.config.ts `allowedDevOrigins`), so
  // sign-in works over a `*.trycloudflare.com` tunnel or a LAN IP too.
  // -------------------------------------------------------------------
  trustedOrigins:
    envServer.MODE === SITE_MODES.PRODUCTION
      ? [envClient.NEXT_PUBLIC_APP_URL]
      : // Deduplicated because NEXT_PUBLIC_APP_URL is usually one of the
        // loopback origins already, and a repeated entry in this list reads
        // like two different things are trusted when only one is.
        [
          ...new Set([
            envClient.NEXT_PUBLIC_APP_URL,
            ...loopbackOriginsFor(envClient.NEXT_PUBLIC_APP_URL),
            "*.trycloudflare.com",
            "192.168.*.*",
            "10.*.*.*",
          ]),
        ],

  // -------------------------------------------------------------------
  // Plugins
  // -------------------------------------------------------------------
  plugins: [
    // Admin plugin - powers "View as" (an admin signing into another user's
    // portal to see what they see). Impersonation sessions are capped at 1 hour
    // and are recorded on the session row (impersonated_by) and in the audit log.
    //
    // Only ADMIN appears in `roles`, so only an admin holds the impersonate
    // permission - a manager cannot impersonate anyone, including their own
    // team's members.
    //
    // `adminRoles` is also what better-auth checks to decide who may not be
    // impersonated, so listing ADMIN alone means managers and members can be
    // impersonated by an admin. That is deliberate: an admin already holds
    // every permission a manager does, so impersonating one grants nothing new,
    // and the act is attributable. Admins cannot impersonate each other
    // (allowImpersonatingAdmins stays at its default of false).
    //
    // NOTE: this plugin's schema also declares unused ban columns
    // (users.banned / ban_reason / ban_expires) - we build no ban UI; they stay NULL.
    admin({
      ac: accessControl,
      roles: {
        [USER_ROLES.ADMIN]: impersonatorOnly,
      },
      adminRoles: [USER_ROLES.ADMIN],
      defaultRole: USER_ROLES.MEMBER,
      impersonationSessionDuration: 60 * 60, // 1 hour
    }),
    // Two-factor. `enable` stages a secret; the user must verify a code
    // (verifyTotp) before 2FA actually turns on - so a bad scan can never lock
    // them out. The issuer is what shows in the authenticator app.
    twoFactor({
      issuer: envClient.NEXT_PUBLIC_APP_TITLE,
      // Single-use recovery code for when the authenticator is lost. Default is
      // 10; one is enough here and simplest to store safely.
      backupCodeOptions: { amount: 1 },
      // Email one-time code as an alternative to the authenticator app at
      // sign-in. Configuring sendOTP is what makes the "otp" method available;
      // any user who has turned 2FA on can now choose to receive a code by
      // email instead. The code lives in the verifications table (no new schema).
      otpOptions: {
        period: TWO_FACTOR_OTP_PERIOD_MINUTES,
        sendOTP: async ({ user, otp }) => {
          await sendTwoFactorOtpEmail({
            toAddress: user.email,
            otp,
            validMinutes: TWO_FACTOR_OTP_PERIOD_MINUTES,
          });
        },
      },
    }),
    nextCookies(), // must remain the last plugin
  ],

  // -------------------------------------------------------------------
  // Email and Password
  // -------------------------------------------------------------------
  emailAndPassword: {
    enabled: true,
    // Keep the server-side password bounds in sync with the client Zod schemas
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({
        toAddress: user.email,
        resetUrl: url,
      });
    },
    revokeSessionsOnPasswordReset: true,
    requireEmailVerification: false,
    autoSignIn: true,
  },

  // -------------------------------------------------------------------
  // Email Verification - powers the change-email flow (link to new address)
  // -------------------------------------------------------------------
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({
        toAddress: user.email,
        verifyUrl: url,
      });
    },
    // When an email change is confirmed, revoke all of the user's sessions so
    // they have to sign in again with the new email.
    afterEmailVerification: async (user) => {
      await deleteSessionsByUserIdRepo(user.id);
    },
  },

  // -------------------------------------------------------------------
  // Better Auth Users Model
  // -------------------------------------------------------------------
  user: {
    modelName: "users",
    additionalFields: {
      // role and isActive are assigned server-side only (invite flow / admin
      // maintenance). input:false makes Better Auth reject them on the public
      // update-user endpoint and ignore them on sign-up, so a user cannot
      // grant itself a privileged role (mass-assignment / privilege escalation).
      role: {
        type: "string",
        required: true,
        defaultValue: USER_ROLES.MEMBER,
        input: false,
      },

      isActive: {
        type: "boolean",
        required: true,
        defaultValue: true,
        input: false,
      },

      // Optional short name the person is greeted by (personalisation only).
      // Safe for the user to set themselves, so input is allowed.
      preferredName: {
        type: "string",
        required: false,
        input: true,
      },
    },

    // -------------------------------------------------------------------
    // Change Email - sends a verification link to the new address
    // -------------------------------------------------------------------
    changeEmail: {
      enabled: true,
    },
  },

  // -------------------------------------------------------------------
  // Better Auth Settings Model
  // -------------------------------------------------------------------
  session: {
    modelName: "sessions",
    expiresIn: 60 * 60 * 24 * 5, // 5 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
    cookieCache: {
      enabled: false,
    },
  },

  // -------------------------------------------------------------------
  // Better Auth Accounts Model
  // -------------------------------------------------------------------
  account: {
    modelName: "accounts",
  },

  // -------------------------------------------------------------------
  // Better Auth Verifications Model
  // -------------------------------------------------------------------
  verification: {
    modelName: "verifications",
  },

  // -------------------------------------------------------------------
  // Rate Limits
  // -------------------------------------------------------------------
  rateLimit: {
    // Brute-force protection, so it only needs to run in real production. Better
    // Auth otherwise keys "enabled" off NODE_ENV, which `next start` forces to
    // production - throttling the E2E suite (which seeds many users in a burst
    // against a production build) even though MODE is development. Gate it on
    // MODE instead, matching how useSecureCookies / trustedOrigins are gated.
    enabled: envServer.MODE === SITE_MODES.PRODUCTION,
    window: 10, // time window in seconds
    max: 5, // max requests in the window
  },

  // -------------------------------------------------------------------
  // Advanced
  // -------------------------------------------------------------------
  advanced: {
    cookiePrefix: envClient.NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX,
    useSecureCookies: envServer.MODE === SITE_MODES.PRODUCTION,
  },

  // -------------------------------------------------------------------
  // Request-level hooks - observe auth endpoints for audit events that don't
  // map to a single row change (explicit sign-out, failed sign-in). Best
  // effort and fully guarded: an audit failure never breaks the auth flow.
  // -------------------------------------------------------------------
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const c = ctx as unknown as {
        path?: string;
        headers?: { get?: (name: string) => string | null };
        body?: { email?: string } | null;
        context?: {
          session?: { user?: { id: string; role?: string | null; name?: string | null } } | null;
          returned?: unknown;
        } | null;
      };
      try {
        const path = c.path ?? "";
        const ipAddress = c.headers?.get?.("x-forwarded-for") ?? null;
        const userAgent = c.headers?.get?.("user-agent") ?? null;

        if (path === "/sign-out") {
          const user = c.context?.session?.user;
          await recordAuthAuditEvent({
            action: AUDIT_ACTIONS.AUTH_SIGNED_OUT,
            actor: { id: user?.id ?? null, role: user?.role ?? null, name: user?.name ?? null },
            summary: user?.name ? `${user.name} signed out` : "A user signed out",
            metadata: { ipAddress, userAgent },
          });
          return;
        }

        // A failed sign-in returns an APIError rather than creating a session.
        if (path.startsWith("/sign-in") && c.context?.returned instanceof Error) {
          const email = c.body?.email ?? null;
          await recordAuthAuditEvent({
            action: AUDIT_ACTIONS.AUTH_SIGN_IN_FAILED,
            actor: { id: null, role: null, name: email },
            summary: email ? `Failed sign-in attempt for ${email}` : "Failed sign-in attempt",
            metadata: { ipAddress, userAgent, email },
          });
        }
      } catch (error) {
        console.error("[auth] request-hook audit failed", error);
      }
    }),
  },

  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await getUserByUserIdRepo(session.userId);

          if (!user || !user.isActive) {
            throw new APIError("FORBIDDEN", {
              message:
                "Your account has been deactivated. Please contact your administrator if you believe this is an error.",
            });
          }

          return {
            data: session,
          };
        },
        // Audit trail: log admin impersonation starts, and otherwise a normal
        // successful sign-in. The session row carries { userId, impersonatedBy,
        // ipAddress, userAgent }.
        after: async (session) => {
          const meta = session as {
            userId: string;
            id: string;
            impersonatedBy?: string | null;
            ipAddress?: string | null;
            userAgent?: string | null;
          };
          if (meta.impersonatedBy) {
            console.info(
              `[impersonation] admin ${meta.impersonatedBy} started acting as user ${meta.userId} (session ${meta.id})`,
            );
            return;
          }
          try {
            const user = await getUserByUserIdRepo(meta.userId);
            await recordAuthAuditEvent({
              action: AUDIT_ACTIONS.AUTH_SIGNED_IN,
              actor: { id: meta.userId, role: user?.role ?? null, name: user?.name ?? null },
              summary: `${user?.name ?? meta.userId} signed in`,
              metadata: { ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
            });
          } catch (error) {
            console.error("[auth] sign-in audit failed", error);
          }
        },
      },
    },
    account: {
      update: {
        // A credential (password) change/reset updates the accounts row. This
        // app is email/password only, so an account update is effectively a
        // password change.
        after: async (account) => {
          try {
            const meta = account as { userId?: string | null };
            if (!meta.userId) return;
            const user = await getUserByUserIdRepo(meta.userId);
            await recordAuthAuditEvent({
              action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
              actor: { id: meta.userId, role: user?.role ?? null, name: user?.name ?? null },
              summary: `${user?.name ?? meta.userId} changed their password`,
            });
          } catch (error) {
            console.error("[auth] password-change audit failed", error);
          }
        },
      },
    },
  },
});
