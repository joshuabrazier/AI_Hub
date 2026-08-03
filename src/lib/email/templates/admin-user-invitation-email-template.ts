import { BRAND } from "@/lib/brand";
import { EmailInfoRow, EMAIL_ACCENT, renderEmailLayout } from "./email-layout";

type UserInvitationEmailParams = {
  inviteUrl: string;
  recipientName?: string;
  inviterName?: string;
  role?: string;
  expiryDays?: number;
};

function prettyRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

// -------------------------------------------------------------------
// Invitation email
// Sign-up is invite-only, so this is how every account begins.
// -------------------------------------------------------------------
export function AdminUserInvitationEmailTemplate({
  inviteUrl,
  recipientName,
  inviterName,
  role,
  expiryDays,
}: UserInvitationEmailParams) {
  const info: EmailInfoRow[] = [];
  if (inviterName) info.push({ label: "Invited by", value: inviterName });
  if (role) info.push({ label: "Your role", value: prettyRole(role) });
  if (expiryDays) info.push({ label: "Invite expires in", value: `${expiryDays} days` });

  const greeting = recipientName ? `Hi ${recipientName},` : "Hi there,";

  return renderEmailLayout({
    preheader: `You have been invited to join ${BRAND.name}`,
    accent: EMAIL_ACCENT,
    heading: "You have been invited",
    intro: `${greeting} you have been invited to join ${BRAND.name}. Use the button below to set up your account.`,
    info: info.length ? info : undefined,
    infoPosition: "after",
    button: { label: "Set up your account", url: inviteUrl },
    note: expiryDays
      ? `This invitation link expires in ${expiryDays} days. If you were not expecting it, you can ignore this email.`
      : "If you were not expecting this, you can ignore this email.",
  });
}
