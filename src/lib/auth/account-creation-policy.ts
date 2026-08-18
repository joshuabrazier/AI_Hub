import "server-only";

import { envServer } from "@/lib/env-server";
import { getLatestInvitationByEmailRepo } from "@/lib/data/repositories/user-invitations.repository";

// -------------------------------------------------------------------
// Who is allowed to have an account at all.
//
// This is the single gate on account CREATION, and it is enforced from a
// Better Auth `databaseHooks.user.create.before` hook rather than from any
// page or action. That placement is the point: it holds for every path that
// could ever create a user - the invite form, Microsoft sign-in, a future
// provider, or anything a later change adds - instead of being a check some
// new entry point can forget.
//
// TWO RULES, BOTH REQUIRED.
//
//   1. The address must be on the configured domain allowlist.
//   2. A usable invitation must already exist for that exact address.
//
// The second is what keeps this app invite-only after adding SSO. Without
// it, turning on an Entra provider silently converts "an admin decides who
// has an account" into "anyone in the tenant does" - which is a much larger
// change than adding a sign-in button, and not one anybody would see in a
// diff of the auth config.
//
// Rule 1 is not redundant with a single-tenant Entra app, and that is the
// part worth understanding: B2B **guest** users live inside your tenant with
// their own external addresses. A single-tenant app authenticates them
// happily. The domain check is what actually holds the line, and the
// provider config rejects guests by their `acct` claim as well.
// -------------------------------------------------------------------

export type AccountCreationDecision = { allowed: true } | { allowed: false; reason: string };

// -------------------------------------------------------------------
// Is this address on the allowlist?
//
// An EMPTY allowlist means unrestricted. That is the right default for a
// base repo that knows nothing about the organisation deploying it, and the
// wrong setting for a real deployment - which is why it is called out in
// .env.example and in the deployment runbook rather than left to be noticed.
//
// Compared on the last label boundary, not `endsWith`: a naive suffix test
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
// May an account be created for this address?
//
// Called with the email Better Auth is about to write. For a Microsoft
// sign-in that is the address on the verified Entra profile, so the
// invitation lookup below is what ties a tenant identity to an invitation
// an admin actually issued - somebody cannot accept a colleague's invite
// with their own Microsoft account, because the lookup is by the address
// the identity provider asserted, not by the token in the link.
// -------------------------------------------------------------------
export async function canCreateAccountFor(email: string): Promise<AccountCreationDecision> {
  const normalised = email.trim().toLowerCase();

  if (!isEmailDomainAllowed(normalised)) {
    return { allowed: false, reason: "email_domain_not_allowed" };
  }

  // Already filtered to PENDING by the repository, newest first. Note the
  // caveat it documents: two concurrent pending invitations to the same
  // address are indistinguishable by email alone. That is fine here, because
  // this decides only WHETHER an account may exist - the invited role and
  // team still come from the token row on the accept-invite path, which is
  // the only row that can be shown to be the one actually accepted.
  const invitation = await getLatestInvitationByEmailRepo(normalised);

  if (!invitation) {
    return { allowed: false, reason: "no_invitation" };
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    return { allowed: false, reason: "invitation_expired" };
  }

  return { allowed: true };
}

// -------------------------------------------------------------------
// Whether Microsoft sign-in is available on this deployment.
//
// Read by the server routes that render a sign-in surface, so the button
// appears only where it would actually work. Deliberately derived from the
// same variables auth.ts registers the provider from - a NEXT_PUBLIC flag
// would be a second source of truth that could disagree with it, and the
// failure mode there is a button that leads nowhere.
// -------------------------------------------------------------------
export function isMicrosoftSignInConfigured(): boolean {
  return Boolean(
    envServer.MICROSOFT_CLIENT_ID && envServer.MICROSOFT_CLIENT_SECRET && envServer.MICROSOFT_TENANT_ID,
  );
}
