import { z } from "zod";

// -------------------------------------------------------------------
// Contact content
//
// The Contact page stores structured details rather than free text. They are
// persisted as a JSON string in site_content under the "contact" key, and
// parsed back into this shape for editing and rendering.
//
// The email here is also where public enquiries are delivered, so it must stay
// editable from the admin area. In the previous version this key was excluded
// from the editable set, which meant enquiries went to a hardcoded address
// changeable only by direct SQL - and they appeared to send while going
// nowhere.
// -------------------------------------------------------------------
export const contactDetailsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.string().trim().max(40).default(""),
  location: z.string().trim().max(160).default(""),
  hours: z.string().trim().max(120).default(""),
});

export type ContactDetails = z.infer<typeof contactDetailsSchema>;

export const DEFAULT_CONTACT_DETAILS: ContactDetails = {
  email: "hello@example.com",
  phone: "",
  location: "",
  hours: "Mon to Fri, 9am to 5pm",
};

// -------------------------------------------------------------------
// Parse the stored JSON, tolerating missing or invalid values by falling back
// field by field: the contact page must still render something sensible if the
// stored value is malformed.
// -------------------------------------------------------------------
export function parseContactDetails(value: string): ContactDetails {
  try {
    const parsed = contactDetailsSchema.partial().safeParse(JSON.parse(value));
    if (!parsed.success) return DEFAULT_CONTACT_DETAILS;

    return {
      email: parsed.data.email ?? DEFAULT_CONTACT_DETAILS.email,
      phone: parsed.data.phone ?? DEFAULT_CONTACT_DETAILS.phone,
      location: parsed.data.location ?? DEFAULT_CONTACT_DETAILS.location,
      hours: parsed.data.hours ?? DEFAULT_CONTACT_DETAILS.hours,
    };
  } catch {
    return DEFAULT_CONTACT_DETAILS;
  }
}
