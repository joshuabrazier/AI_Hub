import { APIError, betterAuth } from "better-auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SITE_MODES } from "../../lib/constants";
import { envClient } from "../../lib/env-client";
import { database } from "../../lib/data/kysely-database-client";
import { envServer } from "../../lib/env-server";
import { USER_ROLES } from "../../lib/data/kysely-database-types";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { sendTwoFactorOtpEmail, sendVerificationEmail } from "../email/send-email";
import { deleteSessionsByUserIdRepo } from "../data/repositories/sessions.repository";
import { getUserByUserIdRepo } from "../data/repositories/users.repository";
import { ROUTES } from "../routes";
import { accessControl, impersonatorOnly } from "./auth-permissions";
import { isEmailDomainAllowed, isPasswordSignInEnabled } from "./account-creation-policy";
import { applyInvitationOnFirstSignIn } from "./apply-invitation";
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
// -------------------------------------------------------------------
// Session lifetime - two limits, doing two different jobs.
//
// IDLE (expiresIn, sliding). Refreshed on use, so somebody working every
// day is never signed out. On its own this is not a lifetime at all: a
// session used once a day rolls forward indefinitely, which is how a
// five-day window turned into "never expires" in practice.
//
// ABSOLUTE (enforced on read in session-auth-server). A hard ceiling from
// the moment the session was created, regardless of activity. This is the
// one that guarantees everybody re-authenticates on a known cadence, and it
// is why a stolen session cookie has a bounded life rather than an
// unbounded one.
//
// Both are short because re-authenticating here is nearly free: sign-in is
// Microsoft only, so it is normally a silent SSO redirect rather than a
// password prompt. The usual argument against short sessions - that they
// annoy people - mostly does not apply.
//
// Better Auth has no built-in absolute cap, which is why only the first of
// these appears in its config below.
// -------------------------------------------------------------------
export const SESSION_IDLE_SECONDS = 60 * 60 * 24; // 24 hours
export const SESSION_ABSOLUTE_MAX_SECONDS = 60 * 60 * 24 * 7; // 7 days

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
      // -------------------------------------------------------------
      // Enrolling and disabling normally require the account's password,
      // as re-authentication before changing a security setting. An Entra
      // account HAS no password, so without this the endpoints are
      // unreachable for every real user and 2FA could never be turned on.
      //
      // It is not a blanket relaxation: shouldRequirePassword still looks
      // for a `credential` account and demands the password when one
      // exists, so the local dev accounts created by
      // scripts/create-dev-user.mjs are unaffected. Only accounts that
      // genuinely have no password skip the check.
      //
      // What stands in for re-authentication on the Entra path is the
      // session itself, which Microsoft issued and which this app already
      // treats as proof of identity everywhere else.
      // -------------------------------------------------------------
      allowPasswordless: true,
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
  // Microsoft sign-in (Entra ID)
  //
  // Only registered when the three MICROSOFT_* variables are set, so a
  // deployment without Entra is unchanged and the button does not render.
  //
  // TENANT_ID IS NOT OPTIONAL IN PRACTICE. Better Auth defaults it to
  // "common", which accepts any Microsoft account in the world - including
  // personal outlook.com ones. Passing the organisation's own tenant makes
  // Entra itself the first gate, and the domain allowlist the second.
  //
  // `mapProfileToUser` is where a GUEST is turned away. A single-tenant app
  // still authenticates B2B guests, who are in your directory with their own
  // external addresses; `acct` is 0 for a member of the tenant and 1 for a
  // guest, so this is a precise check rather than an inference from the
  // address. The domain allowlist would catch most of them anyway - this
  // catches a guest who happens to share the domain too.
  // -------------------------------------------------------------------
  socialProviders:
    envServer.MICROSOFT_CLIENT_ID && envServer.MICROSOFT_CLIENT_SECRET && envServer.MICROSOFT_TENANT_ID
      ? {
          microsoft: {
            clientId: envServer.MICROSOFT_CLIENT_ID,
            clientSecret: envServer.MICROSOFT_CLIENT_SECRET,
            tenantId: envServer.MICROSOFT_TENANT_ID,
            // The photo fetch is an extra Graph call per sign-in for an
            // avatar this app does not display.
            disableProfilePhoto: true,
            mapProfileToUser: (profile) => {
              if (profile.acct === 1) {
                throw new APIError("FORBIDDEN", {
                  message: "Guest accounts cannot be used to sign in to this application.",
                });
              }

              // `email` is not always present on an Entra token; the UPN is,
              // and for a member of the tenant it is their address.
              const email = (profile.email ?? profile.preferred_username ?? "").toLowerCase();

              return { email, name: profile.name };
            },
          },
        }
      : undefined,

  // -------------------------------------------------------------------
  // Email and password: OFF in production, opt-in locally.
  //
  // Microsoft is the only way into a real environment. Password sign-in is
  // registered only when DEV_PASSWORD_SIGN_IN is set AND MODE is not
  // production - see isPasswordSignInEnabled. It exists because without an
  // Entra app registration the sign-in page has no button on it and there is
  // no way in at all, which makes the app unrunnable locally.
  //
  // WHAT IT COSTS, stated plainly: while it is on, an account can be signed
  // into without Entra ever seeing it, which is the whole reason this is
  // normally a single front door. Nothing else is relaxed - the domain
  // allowlist still gates account creation, the deactivated-account check
  // still runs, and sign-ins are still audited - but the door is no longer
  // single, so do not turn it on anywhere that matters.
  //
  // There is no sign-up surface and no password-reset surface, and adding
  // one is not the intent. A local account is created by
  // scripts/create-dev-user.mjs, which writes the credential row directly.
  // So the flag opens a door; it does not hand out keys, and a project that
  // never runs that script gains nothing by setting it.
  //
  // THE OPERATIONAL RISK ON THE ENTRA SIDE is unchanged and is not visible
  // from the code: if the Entra client secret expires or the app
  // registration breaks, NOBODY can sign in to production, including admins,
  // and the fix is in Azure rather than in this app. Diarise the expiry.
  // -------------------------------------------------------------------
  emailAndPassword: {
    enabled: isPasswordSignInEnabled(),
    // Keep the server-side password bounds in sync with the client Zod schemas
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
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
  // -------------------------------------------------------------------
  // Where a failed auth request lands.
  //
  // The per-sign-in `errorCallbackURL` is not enough on its own, and the
  // reason is circular: Better Auth stores it INSIDE the OAuth state row,
  // so the one failure it cannot use it for is a missing state row. That is
  // exactly what "State mismatch: verification not found" is - a callback
  // replayed after the state was consumed (a refresh or a back button on
  // the return URL), or one that came back after the row expired.
  //
  // Without this the person is dropped on Better Auth's bare error page at
  // /api/auth/error. With it they land back on sign-in and can simply try
  // again, which is the correct answer for both causes.
  //
  // `throw` stays false: an auth error should redirect somebody, not
  // surface as an unhandled exception in a request handler.
  // -------------------------------------------------------------------
  onAPIError: {
    errorURL: ROUTES.PUBLIC_AUTH_SIGN_IN,
  },

  session: {
    modelName: "sessions",
    // The IDLE window. Stop using the app for this long and the session is
    // gone. Every request within it pushes the expiry out again, so this is
    // a sliding limit and an active session never reaches it - which is
    // exactly why SESSION_ABSOLUTE_MAX_SECONDS below has to exist as well.
    expiresIn: SESSION_IDLE_SECONDS,
    // How often that push is written. Hourly rather than daily so the idle
    // window is measured with some precision - with a coarse update age, a
    // session touched once can look fresh for most of a day after the
    // person stopped using it.
    updateAge: 60 * 60,
    cookieCache: {
      // Off deliberately. Every request reads the session from the
      // database, which is what makes revoking one take effect immediately
      // instead of whenever a cached cookie happens to lapse. It is also
      // what lets the absolute cap be enforced on read at all.
      enabled: false,
    },
  },

  // -------------------------------------------------------------------
  // Account linking.
  //
  // Stated explicitly rather than left to defaults, because what it decides
  // is whether an existing account can still be signed into.
  //
  // An account created before Microsoft sign-in existed has a `credential`
  // row and no social one. On the first Entra sign-in at the same address,
  // Better Auth links the identity into that row instead of failing - which
  // is how a pre-existing admin keeps working after passwords were turned
  // off. Without linking they would be locked out of their own app.
  //
  // The safety condition is `requireLocalEmailVerified`, left at its default
  // of true: the local row must ALREADY have emailVerified set before an
  // IdP identity is linked into it. That is what stops somebody registering
  // an unverified account at a colleague's address and having the
  // colleague's Entra identity attached to it on first sign-in. Do not turn
  // it off.
  //
  // `microsoft` is trusted because the tenant is pinned and guests are
  // rejected, so an address it asserts has been verified by the directory
  // this app is deployed for.
  // -------------------------------------------------------------------
  account: {
    modelName: "accounts",
    accountLinking: {
      enabled: true,
      trustedProviders: ["microsoft"],
    },
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
    // -------------------------------------------------------------------
    // The single gate on account creation, and the ONLY one.
    //
    // The app auto-provisions: anybody in the tenant on an allowed domain
    // gets an account on first Microsoft sign-in, as a member. So this hook
    // is the entire access boundary, which is why it sits at the database
    // layer rather than in a page - it holds for every path that could ever
    // create a user, including ones added later.
    //
    // If AUTH_ALLOWED_EMAIL_DOMAINS is unset there is NO restriction at all.
    // That default is right for a base repo and wrong for a deployment.
    //
    // The `after` hook applies a pending invitation's role and team, if one
    // exists. An invitation is no longer required to get in; it is how an
    // admin says in advance what somebody should land as.
    //
    // Throwing rather than returning false: a false return makes Better Auth
    // hand back a null user, which surfaces as an unexplained failure. An
    // APIError produces a message the person can act on.
    // -------------------------------------------------------------------
    user: {
      create: {
        before: async (user) => {
          if (!isEmailDomainAllowed(user.email)) {
            console.warn(`[auth] refused account creation for ${user.email}: email_domain_not_allowed`);

            throw new APIError("FORBIDDEN", {
              message: "Your account is not permitted to access this application.",
            });
          }

          return { data: user };
        },
        after: async (user) => {
          // Best-effort, and deliberately so: this decorates a new account
          // with a role and a team an admin chose in advance. If it fails,
          // the person still has a working member account and an admin can
          // set both from the users screen. Throwing here would leave them
          // with an account they cannot sign into.
          try {
            await applyInvitationOnFirstSignIn(user.id, user.email);
          } catch (error) {
            console.error("[auth] failed to apply invitation on first sign-in", error);
          }
        },
      },
    },

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
