import { format } from "date-fns";
import { Files } from "lucide-react";

import RichText from "@/components/content/rich-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PortalPage from "@/features/layout/portal-page";

import { SignDocumentDialog } from "./components/sign-document-dialog";
import { getMyDocumentsService } from "./documents.service";
import type { MemberDocumentDTO } from "./documents.types";

// The status chip for one document. A document signed against an older version
// is not "signed" - the wording moved on, so it is asking to be signed again.
function statusBadge(doc: MemberDocumentDTO) {
  if (doc.signed) return <Badge variant="success">Signed</Badge>;
  if (doc.signedVersion !== null) return <Badge variant="destructive">Update needed</Badge>;
  if (doc.isRequired) return <Badge variant="destructive">Action needed</Badge>;
  return <Badge variant="secondary">Optional</Badge>;
}

function statusLine(doc: MemberDocumentDTO): string {
  if (doc.signed) {
    return doc.signedAt ? `Signed on ${format(doc.signedAt, "d MMM yyyy")}` : "Signed";
  }

  if (doc.signedVersion !== null) {
    return `You signed version ${doc.signedVersion}, version ${doc.version} is now current`;
  }

  return "Not yet signed";
}

// -------------------------------------------------------------------
// Member documents
//
// The documents on offer are rows in the `documents` table, so this page never
// names one. The service reads the signed-in member's signatures by session id,
// which is why the route carries no id.
// -------------------------------------------------------------------
export default async function DocumentsPage() {
  const { documents, outstandingCount } = await getMyDocumentsService();

  return (
    <PortalPage
      eyebrow="Your portal"
      title="Documents"
      description={
        outstandingCount > 0
          ? `You have ${outstandingCount} ${outstandingCount === 1 ? "document" : "documents"} still to sign.`
          : "Everything here is signed and up to date."
      }
    >
      {documents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Files size={22} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">Nothing to sign</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Documents you need to read and sign appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <CardHeader>
                <CardTitle>{doc.title}</CardTitle>
                <CardDescription>{statusLine(doc)}</CardDescription>
                <CardAction>{statusBadge(doc)}</CardAction>
              </CardHeader>
              <CardContent>
                {/* The wording is rendered here, on the server, and passed into
                    the dialog as children - so it is sanitised before it ever
                    reaches the browser. */}
                <SignDocumentDialog doc={doc}>
                  <RichText html={doc.content} />
                </SignDocumentDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PortalPage>
  );
}
