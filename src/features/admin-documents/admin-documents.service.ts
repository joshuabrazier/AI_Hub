import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import {
  requireManagementScope,
  requireUserRole,
  type TeamScope,
} from "@/lib/auth/session-auth-server";
import { decryptField } from "@/lib/crypto/field-encryption";
import {
  NewDocumentRecord,
  UpdateDocumentRecord,
  USER_ROLES,
} from "@/lib/data/kysely-database-types";
import {
  getAllDocumentSignersRepo,
  getDocumentSignersByTeamsRepo,
  getLatestDocumentSignaturesRepo,
  type DocumentSignerRow,
  type LatestDocumentSignatureRow,
} from "@/lib/data/repositories/admin-documents.repository";
import { getDocumentSignatureByIdUnscopedRepo } from "@/lib/data/repositories/document-signatures.repository";
import {
  createDocumentRepo,
  deleteDocumentByIdRepo,
  getActiveDocumentsRepo,
  getAllDocumentsRepo,
  getDocumentByIdRepo,
  getDocumentByKeyRepo,
  updateDocumentByIdRepo,
} from "@/lib/data/repositories/documents.repository";
import { getUserIdsForTeamsRepo } from "@/lib/data/repositories/team-members.repository";
import { getUserByUserIdRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";

import {
  mapDBDocumentToDocumentResponseDTO,
  mapDBSignerToDocumentSignerDTO,
} from "./admin-documents.mappers";
import {
  AdminDocumentsDTO,
  CreateDocumentRequestDTO,
  DeleteDocumentRequestDTO,
  SignedDocumentDetailDTO,
  UpdateDocumentRequestDTO,
  ViewSignatureRequestDTO,
} from "./admin-documents.types";

// -------------------------------------------------------------------
// Staff documents service
//
// Two jobs, with two different guards:
//
//   Reading who has signed what is team-scoped, so it goes through
//   requireManagementScope: an admin is unrestricted, a manager sees the
//   members of the teams they hold, and an empty scope sees nobody.
//
//   Editing the document list itself is platform-wide configuration with no
//   team behind it, so it is requireUserRole([ADMIN]).
//
// Both guards live here rather than only in the actions. Signatures carry
// field-encrypted personal data, so a service that trusted its caller would be
// one careless call site away from handing them out.
// -------------------------------------------------------------------

// The people in scope, and the signatures they hold.
async function getScopedSigners(scope: TeamScope): Promise<{
  signers: DocumentSignerRow[];
  latestByUserAndKey: Map<string, Map<string, LatestDocumentSignatureRow>>;
}> {
  // An empty scope must return nobody rather than everybody. The team-scoped
  // query short-circuits an empty id list, so there is no path where "manages
  // no teams" widens into "every member".
  const signers = scope.isUnrestricted
    ? await getAllDocumentSignersRepo()
    : await getDocumentSignersByTeamsRepo(scope.teamIds);

  const signatures = await getLatestDocumentSignaturesRepo(signers.map((signer) => signer.userId));

  const latestByUserAndKey = new Map<string, Map<string, LatestDocumentSignatureRow>>();
  for (const signature of signatures) {
    const forUser = latestByUserAndKey.get(signature.userId);
    if (forUser) {
      forUser.set(signature.documentKey, signature);
    } else {
      latestByUserAndKey.set(signature.userId, new Map([[signature.documentKey, signature]]));
    }
  }

  return { signers, latestByUserAndKey };
}

// -------------------------------------------------------------------
// The documents, and who in scope has signed them.
// -------------------------------------------------------------------
export async function getAdminDocumentsService(): Promise<AdminDocumentsDTO> {
  try {
    const scope = await requireManagementScope();

    // An admin manages the list, so they see retired documents too. A manager
    // only measures people against what is currently being asked for.
    const [allDocuments, activeDocuments, scoped] = await Promise.all([
      scope.isUnrestricted ? getAllDocumentsRepo() : getActiveDocumentsRepo(),
      getActiveDocumentsRepo(),
      getScopedSigners(scope),
    ]);

    const signers = scoped.signers.map((signer) =>
      mapDBSignerToDocumentSignerDTO(
        signer,
        activeDocuments,
        scoped.latestByUserAndKey.get(signer.userId) ?? new Map(),
      ),
    );

    // How many people in scope hold a current signature for each document.
    const signedCountByKey = new Map<string, number>();
    for (const signer of signers) {
      for (const document of signer.documents) {
        if (!document.isCurrent) continue;
        signedCountByKey.set(document.documentKey, (signedCountByKey.get(document.documentKey) ?? 0) + 1);
      }
    }

    return {
      documents: allDocuments.map((document) =>
        mapDBDocumentToDocumentResponseDTO(document, signedCountByKey.get(document.key) ?? 0),
      ),
      signers,
      isUnrestricted: scope.isUnrestricted,
    };
  } catch (error) {
    throw handleError("getAdminDocumentsService", error);
  }
}

// -------------------------------------------------------------------
// Open one stored signature.
//
// This reads another person's field-encrypted name and drawn signature, so the
// unscoped repository lookup is only safe once the caller's entitlement to that
// person's records has been established. A manager may open a signature only
// for somebody in a team they hold; the check is against the session-resolved
// team membership, never against the signature id that was handed in.
// -------------------------------------------------------------------
export async function getSignedDocumentService(
  requestDTO: ViewSignatureRequestDTO,
): Promise<SignedDocumentDetailDTO> {
  try {
    const scope = await requireManagementScope();

    const signature = await getDocumentSignatureByIdUnscopedRepo(requestDTO.signatureId);

    if (!signature) {
      throw new DisplayErrorMessage("That signature could not be found.");
    }

    if (!scope.isUnrestricted) {
      const reachableUserIds = await getUserIdsForTeamsRepo(scope.teamIds);

      if (!reachableUserIds.includes(signature.userId)) {
        // Deliberately the same message as "not found": a manager must not be
        // able to tell an out-of-scope signature apart from one that does not
        // exist, or the id becomes an oracle.
        throw new DisplayErrorMessage("That signature could not be found.");
      }
    }

    // Deliberately NOT the member portal's safeDecryptField. On a staff view a
    // signature that will not decrypt is the finding: blanking the panel would
    // present a broken or tampered record as an unsigned one, and nobody would
    // ever go looking. Fail loudly and name what happened.
    let signerName: string;
    let signatureImage: string;

    try {
      signerName = decryptField(signature.signerName);
      signatureImage = decryptField(signature.signatureImage);
    } catch (error) {
      console.error("[getSignedDocumentService] failed to decrypt a signature", error);
      throw new DisplayErrorMessage(
        "This signature cannot be decrypted, so it cannot be shown. The encryption key may have changed since it was signed.",
      );
    }

    const user = await getUserByUserIdRepo(signature.userId);

    return {
      documentTitle: signature.documentTitle,
      documentVersion: signature.documentVersion,
      // The snapshot is stored HTML and is rendered with dangerouslySetInnerHTML,
      // so it is sanitised again at read.
      documentContent: sanitizeRichText(signature.documentContent),
      signerName,
      signatureImage,
      signedAt: signature.signedAt,
      accountName: user?.name ?? null,
    };
  } catch (error) {
    throw handleError("getSignedDocumentService", error);
  }
}

// -------------------------------------------------------------------
// Create a document.
//
// `key` is UNIQUE and is what every signature snapshots, so a clash is checked
// for here and reported rather than left to surface as a constraint violation.
// -------------------------------------------------------------------
export async function createDocumentService(requestDTO: CreateDocumentRequestDTO): Promise<string> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const existing = await getDocumentByKeyRepo(requestDTO.key);

    if (existing) {
      throw new DisplayErrorMessage("A document with that key already exists.");
    }

    const now = new Date();

    const newDocument: NewDocumentRecord = {
      id: generateId(),
      key: requestDTO.key,
      title: requestDTO.title,
      version: requestDTO.version,
      contentKey: requestDTO.contentKey,
      isRequired: requestDTO.isRequired,
      orderBy: requestDTO.orderBy,
      isActive: requestDTO.isActive,
      createdAt: now,
      updatedAt: now,
    };

    const document = await createDocumentRepo(newDocument);

    revalidatePath(ROUTES.ADMIN_DOCUMENTS);
    revalidatePath(ROUTES.PORTAL_DOCUMENTS);

    return document.id;
  } catch (error) {
    throw handleError("createDocumentService", error);
  }
}

// -------------------------------------------------------------------
// Update a document.
//
// The key is not updatable - see the note on UpdateDocumentSchema. Bumping
// `version` is what forces everybody to sign again, because a signature only
// counts against the version it snapshotted; editing the wording alone (the
// site content row named by contentKey) deliberately does not.
// -------------------------------------------------------------------
export async function updateDocumentService(
  requestDTO: UpdateDocumentRequestDTO,
): Promise<string | undefined> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const existing = await getDocumentByIdRepo(requestDTO.id);

    if (!existing) {
      throw new DisplayErrorMessage("That document no longer exists.");
    }

    const updateDocument: UpdateDocumentRecord = {
      title: requestDTO.title,
      version: requestDTO.version,
      contentKey: requestDTO.contentKey,
      isRequired: requestDTO.isRequired,
      orderBy: requestDTO.orderBy,
      isActive: requestDTO.isActive,
      updatedAt: new Date(),
    };

    const document = await updateDocumentByIdRepo(requestDTO.id, updateDocument);

    revalidatePath(ROUTES.ADMIN_DOCUMENTS);
    revalidatePath(ROUTES.PORTAL_DOCUMENTS);

    return document?.id;
  } catch (error) {
    throw handleError("updateDocumentService", error);
  }
}

// -------------------------------------------------------------------
// Delete a document.
//
// Signatures are NOT lost: document_id is ON DELETE SET NULL and every
// signature carries its own snapshot of the key, title, version and text that
// was signed. Retiring a document with isActive is still the better move when
// the history should stay legible in the overview - a deleted document simply
// stops being one of the columns everybody is measured against.
// -------------------------------------------------------------------
export async function deleteDocumentService(requestDTO: DeleteDocumentRequestDTO): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const existing = await getDocumentByIdRepo(requestDTO.id);

    if (!existing) {
      throw new DisplayErrorMessage("That document no longer exists.");
    }

    await deleteDocumentByIdRepo(requestDTO.id);

    revalidatePath(ROUTES.ADMIN_DOCUMENTS);
    revalidatePath(ROUTES.PORTAL_DOCUMENTS);
  } catch (error) {
    throw handleError("deleteDocumentService", error);
  }
}
