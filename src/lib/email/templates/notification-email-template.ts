import { BRAND } from "@/lib/brand";
import { renderEmailLayout } from "./email-layout";

// -------------------------------------------------------------------
// NotificationEmailTemplate
// The email sent to a client when an admin creates a notification. The
// title becomes the heading/subject and the (already-sanitised) rich-text
// body is rendered as the message, with a button through to the portal.
// -------------------------------------------------------------------
export function NotificationEmailTemplate({
  title,
  bodyHtml,
  portalUrl,
}: {
  title: string;
  bodyHtml: string | null;
  portalUrl: string;
}): string {
  return renderEmailLayout({
    preheader: title,
    heading: title,
    intro: `You have a new notification from ${BRAND.name}.`,
    bodyHtml: bodyHtml ?? undefined,
    button: { label: "View in the portal", url: portalUrl },
  });
}
