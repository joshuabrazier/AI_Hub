import { ROUTES } from "@/lib/routes";
import { envClient } from "../env-client";
import { handleError } from "../handle-errors";

// -------------------------------------------------------------------
// Generate Invitation Link Url
// -------------------------------------------------------------------
export async function generateInvitationLink(inviteToken: string) {
  try {
    const acceptInviteRoute = ROUTES.PUBLIC_ACCEPT_INVITE.replace("{inviteToken}", inviteToken);

    const url = new URL(acceptInviteRoute, envClient.NEXT_PUBLIC_APP_URL);

    return url.toString();
  } catch (error) {
    throw handleError("generateUserInvitationLink", error);
  }
}
