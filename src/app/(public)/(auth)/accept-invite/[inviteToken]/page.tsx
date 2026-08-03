import AcceptInviteValidationPage from "@/features/accept-invite/accept-invite-validation.page";

export default async function AcceptInvite({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;

  return <AcceptInviteValidationPage inviteToken={inviteToken} />;
}
