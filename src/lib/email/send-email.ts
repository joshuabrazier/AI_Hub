import { EmailMessage } from "@azure/communication-email";
import { ROUTES } from "@/lib/routes";
import { envClient } from "../env-client";
import { envServer } from "../env-server";
import { handleError } from "../handle-errors";
import { getEmailClient } from "./email-client";
import { AdminUserInvitationEmailTemplate } from "./templates/admin-user-invitation-email-template";
import { EmailChangeNotificationEmailTemplate } from "./templates/email-change-notification-email-template";
import { EnquiryEmailData, EnquiryEmailTemplate } from "./templates/enquiry-email-template";
import { NotificationEmailTemplate } from "./templates/notification-email-template";
import { PasswordResetEmailTemplate } from "./templates/password-reset-email-template";
import { TwoFactorOtpEmailTemplate } from "./templates/two-factor-otp-email-template";
import { VerifyEmailTemplate } from "./templates/verify-email-template";

type SendEmailParams = {
  toAddress: string;
  subject: string;
  html: string;
  // Optional address to route replies to (e.g. the enquirer), so hitting reply
  // in the inbox goes to them instead of the no-reply sender.
  replyTo?: string;
};

export async function sendEmail({ toAddress, subject, html, replyTo }: SendEmailParams) {
  try {
    // Sending is controlled by the EMAIL_SEND_ENABLED env flag. When it's off
    // we log the email (including any links in the HTML) instead of sending, so
    // hand-testing and the E2E tests don't spend Azure send quota or generate
    // bounces. Turn it on in .env to send real emails from any environment.
    if (!envServer.EMAIL_SEND_ENABLED) {
      console.log(`[email:log-only] to=${toAddress}${replyTo ? ` replyTo=${replyTo}` : ""} subject="${subject}"\n${html}`);
      return;
    }

    const message: EmailMessage = {
      senderAddress: envServer.EMAIL_FROM_ADDRESS,
      content: {
        subject,
        html,
      },
      recipients: {
        to: [{ address: toAddress }],
      },
      ...(replyTo ? { replyTo: [{ address: replyTo }] } : {}),
    };

    // Initiate the send without polling to completion. Azure has accepted the
    // email and will deliver it asynchronously; blocking on delivery would make
    // the caller (e.g. the password-reset request) wait several seconds.
    await getEmailClient().beginSend(message);
  } catch (error) {
    throw handleError("sendEmail", error);
  }
}

type SendInvitationEmailParams = {
  toAddress: string;
  subject: string;
  inviteUrl: string;
  recipientName?: string;
  inviterName?: string;
  role?: string;
  expiryDays?: number;
};

export async function sendAdminUserInvitationEmail({
  toAddress,
  subject,
  inviteUrl,
  recipientName,
  inviterName,
  role,
  expiryDays,
}: SendInvitationEmailParams) {
  try {
    return await sendEmail({
      toAddress,
      subject,
      html: AdminUserInvitationEmailTemplate({ inviteUrl, recipientName, inviterName, role, expiryDays }),
    });
  } catch (error) {
    throw handleError("sendAdminUserInvitationEmail", error);
  }
}

type SendPasswordResetEmailParams = {
  toAddress: string;
  resetUrl: string;
};

export async function sendPasswordResetEmail({ toAddress, resetUrl }: SendPasswordResetEmailParams) {
  try {
    return await sendEmail({
      toAddress,
      subject: "Reset your password",
      html: PasswordResetEmailTemplate({ resetUrl, recipientEmail: toAddress }),
    });
  } catch (error) {
    throw handleError("sendPasswordResetEmail", error);
  }
}

type SendVerificationEmailParams = {
  toAddress: string;
  verifyUrl: string;
};

export async function sendVerificationEmail({ toAddress, verifyUrl }: SendVerificationEmailParams) {
  try {
    return await sendEmail({
      toAddress,
      subject: "Verify your email",
      html: VerifyEmailTemplate({ verifyUrl, recipientEmail: toAddress }),
    });
  } catch (error) {
    throw handleError("sendVerificationEmail", error);
  }
}

type SendTwoFactorOtpEmailParams = {
  toAddress: string;
  otp: string;
  validMinutes: number;
};

// A one-time sign-in code, emailed as an alternative to the authenticator app.
export async function sendTwoFactorOtpEmail({ toAddress, otp, validMinutes }: SendTwoFactorOtpEmailParams) {
  try {
    return await sendEmail({
      toAddress,
      subject: "Your sign-in code",
      html: TwoFactorOtpEmailTemplate({ otp, validMinutes, recipientEmail: toAddress }),
    });
  } catch (error) {
    throw handleError("sendTwoFactorOtpEmail", error);
  }
}

type SendNotificationEmailParams = {
  toAddress: string;
  title: string;
  bodyHtml: string | null;
};

export async function sendNotificationEmail({ toAddress, title, bodyHtml }: SendNotificationEmailParams) {
  try {
    const portalUrl = new URL(ROUTES.PORTAL, envClient.NEXT_PUBLIC_APP_URL).toString();
    return await sendEmail({
      toAddress,
      subject: title,
      html: NotificationEmailTemplate({ title, bodyHtml, portalUrl }),
    });
  } catch (error) {
    throw handleError("sendNotificationEmail", error);
  }
}


type SendEnquiryEmailParams = {
  toAddress: string;
  enquiry: EnquiryEmailData;
};

export async function sendEnquiryEmail({ toAddress, enquiry }: SendEnquiryEmailParams) {
  try {
    return await sendEmail({
      toAddress,
      subject: `New enquiry from ${enquiry.name}`,
      html: EnquiryEmailTemplate(enquiry),
      replyTo: enquiry.email,
    });
  } catch (error) {
    throw handleError("sendEnquiryEmail", error);
  }
}

type SendEmailChangeNotificationParams = {
  toAddress: string;
  newEmail: string;
};

export async function sendEmailChangeNotification({ toAddress, newEmail }: SendEmailChangeNotificationParams) {
  try {
    return await sendEmail({
      toAddress,
      subject: "Your account email is being changed",
      html: EmailChangeNotificationEmailTemplate(newEmail),
    });
  } catch (error) {
    throw handleError("sendEmailChangeNotification", error);
  }
}
