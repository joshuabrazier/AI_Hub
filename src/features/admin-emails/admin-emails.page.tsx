import PortalPage from "@/features/layout/portal-page";

import { buildEmailPreviews } from "./admin-emails.data";
import { EmailPreviewGallery } from "./components/email-preview-gallery";

// -------------------------------------------------------------------
// Admin Emails Page
//
// A gallery of every email the app sends, rendered from the real templates
// with sample data, so it is easy to see what each one looks like before it
// reaches somebody. Read-only, and entirely static - no account, message or
// recipient is touched to build it.
// -------------------------------------------------------------------
export default async function AdminEmailsPage() {
  const emails = buildEmailPreviews();

  return (
    <PortalPage
      eyebrow="Admin"
      title="Emails"
      description="Preview every email the app sends. Choose one on the left to see how it looks in an inbox."
    >
      <EmailPreviewGallery emails={emails} />
    </PortalPage>
  );
}
