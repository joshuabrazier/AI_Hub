import { escapeHtml, renderEmailLayout } from "./email-layout";

// The data the enquiry email needs. Kept as plain values (no feature imports)
// so this template stays decoupled from the enquiry form's schema - the caller
// maps the category to its label and the days to a list.
export type EnquiryEmailData = {
  name: string;
  phone: string;
  email: string;
  categoryLabel: string;
  preferredDays: string[];
  message: string;
};

// -------------------------------------------------------------------
// Enquiry email - sent to the team when someone submits the public enquiry
// form. Structured details go in the panel; the free-text message, if any,
// is escaped and shown as a paragraph.
//
// The accent is left at the layout default deliberately: this is an internal
// notification rather than a branded message to a customer, so it does not
// need a colour of its own.
// -------------------------------------------------------------------
export function EnquiryEmailTemplate(enquiry: EnquiryEmailData): string {
  const days = enquiry.preferredDays.length > 0 ? enquiry.preferredDays.join(", ") : "No preference";

  const message = enquiry.message.trim();
  const bodyHtml = message
    ? `<strong style="display:block; margin-bottom:4px;">Message</strong>${escapeHtml(message).replace(/\n/g, "<br>")}`
    : undefined;

  return renderEmailLayout({
    preheader: `New enquiry from ${enquiry.name}`,
    heading: "New enquiry",
    intro: `${enquiry.name} sent an enquiry through the website. Their details are below.`,
    bodyHtml,
    info: [
      { label: "Name", value: enquiry.name },
      { label: "Phone", value: enquiry.phone },
      { label: "Email", value: enquiry.email },
      { label: "Enquiring about", value: enquiry.categoryLabel || "Not specified" },
      { label: "Preferred days", value: days },
    ],
    infoPosition: "after",
    note: `Reply to ${enquiry.email} or call ${enquiry.phone}.`,
  });
}
