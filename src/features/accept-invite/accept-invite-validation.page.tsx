import { isMicrosoftSignInConfigured } from "@/lib/auth/account-creation-policy";

import { AcceptInviteClientWrapper } from "./components/accept-invite-client-wrapper";

// -------------------------------------------------------------------
// AcceptInviteValidationPageProps
// -------------------------------------------------------------------
type AcceptInviteValidationPageProps = {
  inviteToken: string;
};

export default async function AcceptInviteValidationPage({ inviteToken }: AcceptInviteValidationPageProps) {
  return (
    <AcceptInviteClientWrapper inviteToken={inviteToken} microsoftEnabled={isMicrosoftSignInConfigured()} />
  );
}
