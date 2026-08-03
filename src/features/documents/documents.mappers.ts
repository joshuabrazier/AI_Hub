import type { DocumentRecord, DocumentSignature } from "@/lib/data/kysely-database-types";

import type { MemberDocumentDTO } from "./documents.types";

// -------------------------------------------------------------------
// Mappers are pure: no database, no decryption, no sanitising.
//
// The signer name and signature arrive already decrypted, and the wording
// already sanitised, because both need server-only modules. Doing them at the
// call site also keeps it visible which read path swallowed a decrypt failure
// and which did not - the difference matters, so it should not be buried here.
// -------------------------------------------------------------------

// What the signer sees for one document.
//
// `signature` is their LATEST signature for this document key, whatever version
// it was for. A signature only counts as signed when its snapshotted version
// matches the document's current version, which is what makes bumping the
// version re-prompt everybody.
export function mapDBDocumentToMemberDocumentDTO(
  document: DocumentRecord,
  signature: DocumentSignature | undefined,
  content: string,
  signerName: string | null,
  signatureImage: string | null,
): MemberDocumentDTO {
  const signed = signature?.documentVersion === document.version;

  return {
    id: document.id,
    key: document.key,
    title: document.title,
    version: document.version,
    content,
    isRequired: document.isRequired,
    signed,
    // Only report a signing time for the version on offer. A time next to an
    // out-of-date signature reads as "done" when it is not.
    signedAt: signed ? (signature?.signedAt ?? null) : null,
    signedVersion: signature?.documentVersion ?? null,
    signerName: signed ? signerName : null,
    signatureImage: signed ? signatureImage : null,
  };
}
