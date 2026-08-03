import { BRAND, BRAND_COLORS } from "@/lib/brand";
import { escapeHtml, renderEmailLayout, EMAIL_ACCENT } from "./email-layout";

type TwoFactorOtpEmailParams = {
  otp: string;
  validMinutes: number;
  recipientEmail?: string;
};

const FONT_STACK = "'Segoe UI', Roboto, Oxygen, Ubuntu, Helvetica, Arial, sans-serif";

// -------------------------------------------------------------------
// Two-factor sign-in code email
// Shows a large one-time code the user types in to finish signing in, as an
// alternative to their authenticator app. The code is a server-generated
// numeric string; it is escaped anyway to honour the layout's "bodyHtml is
// inserted verbatim" contract.
// -------------------------------------------------------------------
export function TwoFactorOtpEmailTemplate({ otp, validMinutes, recipientEmail }: TwoFactorOtpEmailParams) {
  const codeBlock = `
    <div style="text-align:center; padding: 8px 0 2px;">
      <span style="display:inline-block; font-family:${FONT_STACK}; font-size:34px; font-weight:800; letter-spacing:10px; color:${BRAND_COLORS.primary}; background:${BRAND_COLORS.surface}; border-radius:12px; padding:16px 24px;">${escapeHtml(otp)}</span>
    </div>`;

  return renderEmailLayout({
    preheader: `Your ${BRAND.name} sign-in code`,
    accent: EMAIL_ACCENT,
    heading: "Your sign-in code",
    intro: `Use this one-time code to finish signing in to your ${BRAND.name} account.`,
    bodyHtml: codeBlock,
    info: recipientEmail ? [{ label: "Account", value: recipientEmail }] : undefined,
    infoPosition: "after",
    note: `This code expires in ${validMinutes} minutes. If you didn't try to sign in, you can ignore this email and your account stays secure.`,
  });
}
