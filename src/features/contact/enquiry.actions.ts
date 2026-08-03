"use server";

import { headers } from "next/headers";

import { ServerApiResponse } from "@/lib/types";
import { validateRequest } from "@/lib/server-requests";
import { handleServerApiError } from "@/lib/handle-errors";
import {
  countRecentEnquiriesByIpRepo,
  recordEnquirySubmissionRepo,
} from "@/lib/data/repositories/enquiry-submissions.repository";

import { EnquiryRequestDTO, EnquirySchema } from "./enquiry.types";
import { submitEnquiryService } from "./enquiry.service";

// Per-IP throttle: at most this many enquiries per rolling window. The form can
// only ever email the school's own inbox, so this exists to cap inbox flooding.
const MAX_ENQUIRIES_PER_WINDOW = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Best-effort client IP from the proxy chain (Azure App Service sets
// x-forwarded-for). Falls back to "unknown" so requests without it still share
// a single throttle bucket rather than bypassing the limit entirely.
function clientIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

// -------------------------------------------------------------------
// Public enquiry submission (no auth - anyone can enquire). Validated
// server-side; the email only ever goes to the school's own inbox. Rate
// limited per IP, with a honeypot + time-trap handled in the service.
// -------------------------------------------------------------------
export async function submitEnquiryAction(request: EnquiryRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    const ip = clientIp(await headers());

    // Fail open if the throttle ledger is unavailable (e.g. the migration hasn't
    // been run in this environment): a public lead form should never drop a real
    // enquiry over a throttling read. The honeypot + time-trap still apply.
    let recentCount = 0;
    try {
      recentCount = await countRecentEnquiriesByIpRepo(ip, new Date(Date.now() - RATE_WINDOW_MS));
    } catch (error) {
      console.error("[submitEnquiryAction] rate-limit check failed; allowing this enquiry", error);
    }
    if (recentCount >= MAX_ENQUIRIES_PER_WINDOW) {
      return {
        success: false,
        formError:
          "You've sent a few enquiries recently. Please give us a little time to get back to you, or email us directly.",
      };
    }

    const validatedRequest = await validateRequest(EnquirySchema, request);
    if (!validatedRequest.success) return validatedRequest.response;

    const { sent } = await submitEnquiryService(validatedRequest.data);

    // Only real sends count toward the limit - silent bot-drops (honeypot /
    // time-trap) never consume a legitimate visitor's budget. Best-effort: a
    // failure to record must not fail the enquiry the visitor already sent.
    if (sent) {
      try {
        await recordEnquirySubmissionRepo(ip);
      } catch (error) {
        console.error("[submitEnquiryAction] failed to record submission for throttling", error);
      }
    }

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("submitEnquiryAction", error);
  }
}
