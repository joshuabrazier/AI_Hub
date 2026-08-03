import ContactPage from "@/features/contact/contact-page";

// Reads admin-editable contact details + enquiry options from the DB, so render
// on demand rather than prerendering at build time.
export const dynamic = "force-dynamic";

export default async function Contact() {
  return <ContactPage />;
}
