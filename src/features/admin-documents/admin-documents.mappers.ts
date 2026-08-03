import type { DocumentRecord } from "@/lib/data/kysely-database-types";
import type {
  DocumentSignerRow,
  LatestDocumentSignatureRow,
} from "@/lib/data/repositories/admin-documents.repository";

import type { DocumentResponseDTO, DocumentSignerDTO, SignerDocumentStatusDTO } from "./admin-documents.types";

// -------------------------------------------------------------------
// Mappers are pure: no database, no decryption, no sanitising.
// -------------------------------------------------------------------

export function mapDBDocumentToDocumentResponseDTO(
  document: DocumentRecord,
  signedCount: number,
): DocumentResponseDTO {
  return {
    id: document.id,
    key: document.key,
    title: document.title,
    version: document.version,
    contentKey: document.contentKey,
    isRequired: document.isRequired,
    orderBy: document.orderBy,
    isActive: document.isActive,
    signedCount,
  };
}

// -------------------------------------------------------------------
// One person, measured against the documents currently on offer.
//
// The comparison is made here rather than in SQL: nothing in the repository
// knows which documents exist or which version is current, so a version bump
// changes the answer with no query to update. The previous design froze the
// version into the query and went stale every time one was bumped.
//
// `latestByKey` holds the person's most recent signature per document key -
// keyed on the snapshotted key, so a signature still counts after the document
// row was renamed or deleted.
// -------------------------------------------------------------------
export function mapDBSignerToDocumentSignerDTO(
  signer: DocumentSignerRow,
  activeDocuments: DocumentRecord[],
  latestByKey: Map<string, LatestDocumentSignatureRow>,
): DocumentSignerDTO {
  const documents: SignerDocumentStatusDTO[] = activeDocuments.map((document) => {
    const signature = latestByKey.get(document.key);
    // A signature only counts against the version it snapshotted.
    const isCurrent = signature?.documentVersion === document.version;

    return {
      documentKey: document.key,
      documentTitle: document.title,
      documentVersion: document.version,
      signatureId: signature?.signatureId ?? null,
      signedVersion: signature?.documentVersion ?? null,
      signedAt: signature?.signedAt ?? null,
      isCurrent,
      isRequired: document.isRequired,
    };
  });

  return {
    userId: signer.userId,
    name: signer.name,
    email: signer.email,
    isActive: signer.isActive,
    teamNames: signer.teamNames,
    documents,
    signedCount: documents.filter((document) => document.isCurrent).length,
    // Only REQUIRED documents count as outstanding. An optional one that has
    // not been signed is a choice, not a gap.
    outstandingCount: documents.filter((document) => document.isRequired && !document.isCurrent).length,
  };
}
