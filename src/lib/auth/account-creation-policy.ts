import "server-only";

import { SITE_MODES } from "@/lib/constants";
import { envServer } from "@/lib/env-server";

// -------------------------------------------------------------------
// Who is allowed to have an account at all.
//
// One rule: the address must be on the configured domain allowlist. It is
// enforced from a Better Auth `databaseHooks.user.create.before` hook rather
// than from any page, so it holds for every path that could ever create a
// user instead of being a check some new entry point can forget.
//
// THIS APP AUTO-PROVISIONS. Anyone in the tenant whose address is on the
// allowlist gets an account on first Microsoft sign-in, as a `member`. An
// admin promotes them afterwards. That is a deliberate choice and it is the
// whole access model - there is no second gate behind this one, so the
// allowlist being correct is the only thing standing between the tenant and
// the app.
//
// A pending invitation is NOT required. One that exists still matters
// though: it pre-assigns the role and team the person lands with, so
// inviting somebody as a manager of a team still means something. See
// applyInvitationOnFirstSignIn in auth.ts.
//
// The allowlist is not redundant with a single-tenant Entra app, and that is
// the part worth understanding: B2B **guest** users live inside your tenant
// with their own external addresses, and a single-tenant app authenticates
// them happily. This check is what actually holds the line, and the provider
// config rejects guests by their `acct` claim as well.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Is this address on the allowlist?
//
// An EMPTY allowlist means unrestricted. That is the right default for a
// base repo that knows nothing about the organisation deploying it, and a
// serious misconfiguration in a deployment that auto-provisions - it would
// let through any account the provider admits. The deployment runbook calls
// it out for exactly that reason.
//
// Compared on the whole domain, not with `endsWith`: a naive suffix test
// would accept "evil-example.com" for an allowlist of "example.com", which
// is a domain an attacker can simply register.
// -------------------------------------------------------------------
export function isEmailDomainAllowed(email: string): boolean {
  const allowed = envServer.AUTH_ALLOWED_EMAIL_DOMAINS;

  if (allowed.length === 0) return true;

  const domain = email.trim().toLowerCase().split("@")[1];

  if (!domain) return false;

  return allowed.includes(domain);
}

// -------------------------------------------------------------------
// Whether Microsoft sign-in is available on this deployment.
//
// Derived from the same variables auth.ts registers the provider from - a
// NEXT_PUBLIC flag would be a second source of truth that could disagree
// with it, and the failure mode there is a sign-in button that leads
// nowhere.
// -------------------------------------------------------------------
export function isMicrosoftSignInConfigured(): boolean {
  return Boolean(
    envServer.MICROSOFT_CLIENT_ID && envServer.MICROSOFT_CLIENT_SECRET && envServer.MICROSOFT_TENANT_ID,
  );
}

// -------------------------------------------------------------------
// Whether password sign-in is available - LOCAL DEVELOPMENT ONLY.
//
// Both conditions are required. DEV_PASSWORD_SIGN_IN is the deliberate
// opt-in; MODE not being production is the backstop for the opt-in having
// been copied somewhere it should not be. An .env is exactly the kind of
// file that gets copied, so the flag on its own would be one careless paste
// away from a password door in production.
//
// Read from one place because auth.ts registers the provider from it and the
// sign-in page decides what to render from it. Two independent checks could
// disagree, and the failure mode is a form that posts to an endpoint that is
// not there.
// -------------------------------------------------------------------
export function isPasswordSignInEnabled(): boolean {
  return envServer.DEV_PASSWORD_SIGN_IN && envServer.MODE !== SITE_MODES.PRODUCTION;
}
