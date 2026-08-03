import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/data/kysely-database-types";
import type { EnquiryRequestDTO } from "./enquiry.types";

// server-only throws if imported outside a server context; stub it.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/repositories/users.repository", () => ({
  getActiveAdminUsersRepo: vi.fn(),
}));
vi.mock("@/lib/email/send-email", () => ({
  sendEnquiryEmail: vi.fn(),
}));
vi.mock("@/features/site-content/site-content.service", () => ({
  getPageContent: vi.fn(),
}));
vi.mock("@/features/site-content/contact-content", () => ({
  parseContactDetails: vi.fn(),
}));

import { submitEnquiryService } from "./enquiry.service";
import { getActiveAdminUsersRepo } from "@/lib/data/repositories/users.repository";
import { sendEnquiryEmail } from "@/lib/email/send-email";
import { parseContactDetails } from "@/features/site-content/contact-content";

const mockAdmins = vi.mocked(getActiveAdminUsersRepo);
const mockSend = vi.mocked(sendEnquiryEmail);
const mockContact = vi.mocked(parseContactDetails);

const admin = (email: string) => ({ email }) as unknown as User;
const contactWith = (email: string) => ({ email }) as unknown as ReturnType<typeof parseContactDetails>;

// A valid, human-looking submission: honeypot empty, past the time-trap.
function enquiry(overrides: Partial<EnquiryRequestDTO> = {}): EnquiryRequestDTO {
  return {
    name: "Jamie Smith",
    phone: "0400000000",
    email: "jamie@example.com",
    category: "General enquiry",
    preferredDays: [],
    message: "Looking for more information.",
    company: "",
    elapsedMs: 5000,
    ...overrides,
  };
}

function recipients(): string[] {
  return mockSend.mock.calls.map((call) => call[0].toAddress);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmins.mockResolvedValue([]);
  mockContact.mockReturnValue(contactWith(""));
  mockSend.mockResolvedValue(undefined);
});

describe("submitEnquiryService", () => {
  it("emails every active admin", async () => {
    mockAdmins.mockResolvedValue([admin("a1@example.com"), admin("a2@example.com")]);
    mockContact.mockReturnValue(contactWith(""));

    const result = await submitEnquiryService(enquiry());

    expect(result).toEqual({ sent: true });
    expect(recipients().sort()).toEqual(["a1@example.com", "a2@example.com"]);
  });

  it("passes the chosen category through to the email as its label", async () => {
    mockAdmins.mockResolvedValue([admin("a1@example.com")]);

    await submitEnquiryService(enquiry({ category: "Booking a class" }));

    expect(mockSend.mock.calls[0][0].enquiry.categoryLabel).toBe("Booking a class");
  });

  it("also includes the contact inbox, deduped against admins", async () => {
    mockAdmins.mockResolvedValue([admin("a1@example.com")]);
    mockContact.mockReturnValue(contactWith("info@example.com"));

    await submitEnquiryService(enquiry());

    expect(recipients().sort()).toEqual(["a1@example.com", "info@example.com"]);
  });

  it("does not email the same address twice when contact equals an admin", async () => {
    mockAdmins.mockResolvedValue([admin("a1@example.com")]);
    mockContact.mockReturnValue(contactWith("a1@example.com"));

    await submitEnquiryService(enquiry());

    expect(recipients()).toEqual(["a1@example.com"]);
  });

  it("falls back to the contact inbox when there are no admins", async () => {
    mockAdmins.mockResolvedValue([]);
    mockContact.mockReturnValue(contactWith("info@example.com"));

    const result = await submitEnquiryService(enquiry());

    expect(result).toEqual({ sent: true });
    expect(recipients()).toEqual(["info@example.com"]);
  });

  it("sends nothing and reports not-sent when there is no recipient at all", async () => {
    mockAdmins.mockResolvedValue([]);
    mockContact.mockReturnValue(contactWith(""));

    const result = await submitEnquiryService(enquiry());

    expect(result).toEqual({ sent: false });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("drops a honeypot submission without emailing anyone", async () => {
    mockAdmins.mockResolvedValue([admin("a1@example.com")]);

    const result = await submitEnquiryService(enquiry({ company: "spam-bot" }));

    expect(result).toEqual({ sent: false });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAdmins).not.toHaveBeenCalled();
  });

  it("drops an implausibly fast submission (time-trap)", async () => {
    mockAdmins.mockResolvedValue([admin("a1@example.com")]);

    const result = await submitEnquiryService(enquiry({ elapsedMs: 100 }));

    expect(result).toEqual({ sent: false });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
