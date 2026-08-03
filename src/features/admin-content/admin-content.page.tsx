import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getSiteContentAction } from "./admin-content.actions";
import { AdminContentEditor } from "./admin-content-editor";
import { ContactDetailsForm } from "./contact-details-form";

export default async function AdminContentPage() {
  const response = await getSiteContentAction();

  return (
    <StandardTablePage response={response}>
      {(content) => (
        <PortalPage
          eyebrow="Admin"
          title="Site content"
          description="Edit your contact details, the text on your public pages, and the documents members sign. Changes go live as soon as you save. The home page has its own editor."
        >
          <div className="space-y-6">
            <ContactDetailsForm contact={content.contact} />
            <AdminContentEditor pages={content.pages} />
          </div>
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
