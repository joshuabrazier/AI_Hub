import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getLandingContentAction } from "./admin-content.actions";
import { AdminHomePageEditor } from "./home-page-editor";

export default async function AdminHomePage() {
  const response = await getLandingContentAction();

  return (
    <StandardTablePage response={response}>
      {(content) => (
        <PortalPage
          eyebrow="Admin"
          title="Home page"
          description="Every block of copy on the public home page. Each one saves separately, and the live page updates as soon as you save."
        >
          <AdminHomePageEditor content={content} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
