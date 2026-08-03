import "server-only";

import { generateId } from "better-auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session-auth-server";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { NewDocumentSignature } from "@/lib/data/kysely-database-types";
import { getActiveDocumentsRepo, getDocumentByKeyRepo } from "@/lib/data/repositories/documents.repository";
import {
  addDocumentSignatureRepo,
  getDocumentSignaturesByUserRepo,
} from "@/lib/data/repositories/document-signatures.repository";
import { getPageContent } from "@/features/site-content/site-content.service";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";

import { mapDBDocumentToMemberDocumentDTO } from "./documents.mappers";
import { MemberDocumentsDTO, SignDocumentRequestDTO } from "./documents.types";

// -------------------------------------------------------------------
// Member documents service
//
// Signable documents are rows in `documents`, not a hardcoded enum, so a
// project adds one by inserting a row. Nothing in this file knows which
// documents exist.
//
// Everything here is keyed by the SESSION user. A document signature belongs to
// a person, not to a role and not to a team, so there is no scope to resolve
// and no id in the request to check one against - requireUser is the whole
// authorization question, and it is asked in this service rather than left to
// the page that calls it.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Decrypt a stored field without letting one bad row take down the page.
//
// A value encrypted under a rotated or mismatched FIELD_ENCRYPTION_KEY fails
// GCM authentication on decrypt. For the OWNER's own view that is worth
// degrading gracefully: they came to read the document, and a signature panel
// that cannot render is not a reason to serve them an error page.
//
// The staff viewer deliberately does NOT do this. There, a signature that
// cannot be decrypted is the finding, and hiding it behind a blank panel would
// present a broken record as an unsigned one.
// -------------------------------------------------------------------
function safeDecryptField(payload: string): string | null {
  try {
    return decryptField(payload);
  } catch (error) {
    console.error("[documents.service] failed to decrypt a signature field", error);
    return null;
  }
}

// -------------------------------------------------------------------
// The active documents with the signed-in user's signing status.
//
// A document counts as signed only when a signature exists for its CURRENT
// version, so bumping a version re-prompts everybody who signed the old one.
// -------------------------------------------------------------------
export async function getMyDocumentsService(): Promise<MemberDocumentsDTO> {
  try {
    const user = await requireUser();

    const [activeDocuments, signatures] = await Promise.all([
      getActiveDocumentsRepo(),
      getDocumentSignaturesByUserRepo(user.id),
    ]);

    // Signatures come back newest first, so the first match for a key is the
    // latest one. Keyed on the snapshotted documentKey rather than documentId,
    // because documentId is ON DELETE SET NULL and the key is what survives.
    const latestByKey = new Map<string, (typeof signatures)[number]>();
    for (const signature of signatures) {
      if (!latestByKey.has(signature.documentKey)) {
        latestByKey.set(signature.documentKey, signature);
      }
    }

    const documents = await Promise.all(
      activeDocuments.map(async (document) => {
        const signature = latestByKey.get(document.key);

        // Show the exact text they signed once they have signed the current
        // version; otherwise the live wording, which is what they are being
        // asked to agree to. Both are sanitised - the signed snapshot is stored
        // HTML and the live value is admin-authored, so neither is trusted.
        const content =
          signature && signature.documentVersion === document.version
            ? sanitizeRichText(signature.documentContent)
            : sanitizeRichText(await getPageContent(document.contentKey));

        return mapDBDocumentToMemberDocumentDTO(
          document,
          signature,
          content,
          signature ? safeDecryptField(signature.signerName) : null,
          signature ? safeDecryptField(signature.signatureImage) : null,
        );
      }),
    );

    return {
      documents,
      outstandingCount: documents.filter((document) => document.isRequired && !document.signed).length,
    };
  } catch (error) {
    throw handleError("getMyDocumentsService", error);
  }
}

// -------------------------------------------------------------------
// Record a signature.
//
// Snapshots the exact key, title, version and text being signed, so a later
// edit or a deleted document row never changes what was already agreed. The
// signer's name and drawn signature are field-encrypted HERE, before they reach
// the repository - that layer stores whatever string it is handed, so this is
// the only place that decides they are encrypted.
// -------------------------------------------------------------------
export async function signDocumentService(requestDTO: SignDocumentRequestDTO): Promise<void> {
  try {
    const user = await requireUser();

    // The key comes from the client, so it is resolved and re-checked here. A
    // retired document must not be signable: it is no longer being asked for,
    // and a signature against it would sit in the record as if it were.
    const document = await getDocumentByKeyRepo(requestDTO.documentKey);

    if (!document || !document.isActive) {
      throw new DisplayErrorMessage("That document is no longer available to sign.");
    }

    // The wording as it stands right now, snapshotted into the immutable row.
    const documentContent = await getPageContent(document.contentKey);

    const requestHeaders = await headers();
    const now = new Date();

    const newSignature: NewDocumentSignature = {
      id: generateId(),
      userId: user.id,
      documentId: document.id,
      documentKey: document.key,
      documentVersion: document.version,
      documentTitle: document.title,
      documentContent,
      signerName: encryptField(requestDTO.signerName),
      signatureImage: encryptField(requestDTO.signatureImage),
      signedAt: now,
      ipAddress: requestHeaders.get("x-forwarded-for"),
      userAgent: requestHeaders.get("user-agent"),
      createdAt: now,
      updatedAt: now,
    };

    await addDocumentSignatureRepo(newSignature);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.DOCUMENT_SIGNED,
      entityType: AUDIT_ENTITY_TYPES.DOCUMENT,
      entityId: newSignature.id,
      // The signer is both the actor and the subject here, but recording the
      // subject explicitly keeps the trail queryable by "what has this person
      // signed" without parsing the summary.
      subjectUserId: user.id,
      summary: `${user.name} signed "${document.title}" (v${document.version})`,
      // The name and the image are encrypted at rest, so the trail records WHICH
      // document was signed and never any part of the signature itself.
      changes: {
        documentKey: document.key,
        documentTitle: document.title,
        documentVersion: document.version,
      },
    });

    revalidatePath(ROUTES.PORTAL_DOCUMENTS);
    revalidatePath(ROUTES.ADMIN_DOCUMENTS);
  } catch (error) {
    throw handleError("signDocumentService", error);
  }
}
