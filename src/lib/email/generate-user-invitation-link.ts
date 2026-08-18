import { ROUTES } from "@/lib/routes";
import { envClient } from "../env-client";
import { handleError } from "../handle-errors";

// -------------------------------------------------------------------
// Where an invitation email sends somebody.
//
// The sign-in page, NOT a token-bearing accept-invite page - that flow is
// gone, along with the password it used to set.
//
// AN INVITATION IS NO LONGER A KEY. Access is decided by Microsoft sign-in
// plus the email domain allowlist, so the token in a link would grant
// nothing: anybody on the domain can already sign in without one. What the
// invitation still does is pre-assign the role and team the person lands
// with, applied by matching the address Entra verified (see
// src/lib/auth/apply-invitation.ts).
//
// So the link is deliberately plain. It carries no secret, which also means
// a forwarded invitation email gives away nothing.
// -------------------------------------------------------------------
export async function generateInvitationLink() {
  try {
    return new URL(ROUTES.PUBLIC_AUTH_SIGN_IN, envClient.NEXT_PUBLIC_APP_URL).toString();
  } catch (error) {
    throw handleError("generateUserInvitationLink", error);
  }
}
