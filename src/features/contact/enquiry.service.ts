import "server-only";

import { parseContactDetails } from "@/features/site-content/contact-content";
import { getPageContent } from "@/features/site-content/site-content.service";
import { SITE_CONTENT_KEYS } from "@/lib/data/kysely-database-types";
import { getActiveAdminUsersRepo } from "@/lib/data/repositories/users.repository";
import { sendEnquiryEmail } from "@/lib/email/send-email";
import { handleError } from "@/lib/handle-errors";

import { EnquiryRequestDTO } from "./enquiry.types";

// A submit faster than this is treated as a bot (the time-trap).
const MIN_FILL_MS = 2000;

// -------------------------------------------------------------------
// Email a website enquiry to the team.
//
// Deliberately has no auth guard: /contact is public, and that is safe here
// because the recipient is never caller-supplied. It is resolved from the
// admin accounts and the admin-managed contact address, so this endpoint can
// only ever mail the organisation's own inboxes - it cannot be turned into a
// relay by anything in the request.
//
// Returns whether an email was actually sent, so the caller only counts real
// sends toward the rate limit and a bot-drop never consumes a legitimate
// visitor's budget.
// -------------------------------------------------------------------
export async function submitEnquiryService(dto: EnquiryRequestDTO): Promise<{ sent: boolean }> {
  try {
    // Bot signals - succeed silently so bots get no feedback, but send
    // nothing: honeypot filled, or the form was submitted implausibly fast.
    if (dto.company.trim() !== "") return { sent: false };
    if (dto.elapsedMs !== undefined && dto.elapsedMs < MIN_FILL_MS) return { sent: false };

    // Notify every active admin. Managers are excluded on purpose: they are
    // scoped to their own teams, and a public enquiry belongs to no team.
    // The admin-managed contact inbox is included too (deduped) so the shared
    // address keeps its copy, and it acts as a fallback so an enquiry is never
    // lost if no admin account exists.
    const admins = await getActiveAdminUsersRepo();
    const recipients = new Set(admins.map((admin) => admin.email).filter((email): email is string => Boolean(email)));

    const contact = parseContactDetails(await getPageContent(SITE_CONTENT_KEYS.CONTACT));
    if (contact.email) recipients.add(contact.email);

    if (recipients.size === 0) return { sent: false };

    const enquiry = {
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      categoryLabel: dto.category,
      preferredDays: dto.preferredDays,
      message: dto.message,
    };

    // One email per recipient so a single bad address can't block the rest.
    const results = await Promise.allSettled(
      [...recipients].map((toAddress) => sendEnquiryEmail({ toAddress, enquiry })),
    );

    return { sent: results.some((result) => result.status === "fulfilled") };
  } catch (error) {
    throw handleError("submitEnquiryService", error);
  }
}
