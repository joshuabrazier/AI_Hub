import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getAdminDocumentsAction } from "./admin-documents.actions";
import { DocumentSignersTable } from "./table/document-signers-table";
import { DocumentsTable } from "./table/documents-table";

// -------------------------------------------------------------------
// Staff documents page
//
// Two things, deliberately on one screen: the documents that exist, and who has
// signed them. They answer the same question from opposite ends, and splitting
// them meant bumping a version in one place and checking its effect in another.
//
// The signing overview is team-scoped, so a manager sees their teams' people.
// The document list itself is platform-wide configuration, so it is only
// rendered - and only writable - for an admin.
// -------------------------------------------------------------------
export default async function AdminDocumentsPage() {
  const response = await getAdminDocumentsAction();

  return (
    <StandardTablePage response={response}>
      {({ documents, signers, isUnrestricted }) => (
        <PortalPage
          eyebrow={isUnrestricted ? "Admin" : "Manager"}
          title="Documents"
          description={
            isUnrestricted
              ? "The documents people are asked to sign, and where everybody stands against them."
              : "Where the people in your teams stand against the documents they are asked to sign."
          }
        >
          <div className="space-y-10">
            {isUnrestricted && (
              <section aria-labelledby="documents-list-heading">
                <h2
                  id="documents-list-heading"
                  className="mb-3 font-heading text-lg font-semibold text-foreground"
                >
                  Documents
                </h2>
                <DocumentsTable documents={documents} />
              </section>
            )}

            <section aria-labelledby="documents-signers-heading">
              <h2
                id="documents-signers-heading"
                className="mb-3 font-heading text-lg font-semibold text-foreground"
              >
                Who has signed what
              </h2>
              <DocumentSignersTable signers={signers} />
            </section>
          </div>
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
