import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import {
  SITE_CONTENT_KEYS,
  SITE_CONTENT_SHAPES,
  type SiteContentKey,
} from "@/lib/data/kysely-database-types";

// Ids are always re-checked server-side; the length bound only keeps obvious
// rubbish out of the query.
const idSchema = z.string().min(TABLE_ID_LENGTH);

// -------------------------------------------------------------------
// The site content keys a signable document may point at.
//
// Only the rich-text ones: a document's wording is HTML that gets rendered and
// snapshotted into a signature, so a key holding a JSON block (the contact
// details, the landing page) would put a serialised object in front of somebody
// being asked to sign it.
// -------------------------------------------------------------------
export const SIGNABLE_CONTENT_KEYS: SiteContentKey[] = Object.values(SITE_CONTENT_KEYS).filter(
  (key) => SITE_CONTENT_SHAPES[key] === "html",
);

const contentKeySchema = z
  .enum(SITE_CONTENT_KEYS)
  .refine((key) => SITE_CONTENT_SHAPES[key] === "html", "That content does not hold document wording");

// -------------------------------------------------------------------
// Shared shape
//
// `key` is absent here on purpose - see the update schema below.
// -------------------------------------------------------------------
const documentBaseShape = {
  title: z.string().trim().min(1, "Title is required").max(120),
  version: z.string().trim().min(1, "Version is required").max(20),
  contentKey: contentKeySchema,
  isRequired: z.boolean(),
  orderBy: z.number().int().min(1).max(999),
  isActive: z.boolean(),
};

export const CreateDocumentSchema = z.object({
  // The stable identifier a signature snapshots. Constrained to a slug so it
  // stays readable in the signature history and in an export.
  key: z
    .string()
    .trim()
    .min(1, "Key is required")
    .max(120)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only"),
  ...documentBaseShape,
});

export type CreateDocumentRequestDTO = z.infer<typeof CreateDocumentSchema>;

// -------------------------------------------------------------------
// Update carries no `key`.
//
// Every signature snapshots the key it was signed under, and every read of
// signing history matches on that snapshot rather than on document_id. Editing
// the key would leave the existing signatures pointing at a document that, as
// far as any query is concerned, no longer exists - so they would silently stop
// counting and everybody would be shown as never having signed.
// -------------------------------------------------------------------
export const UpdateDocumentSchema = z.object({ id: idSchema, ...documentBaseShape });

export type UpdateDocumentRequestDTO = z.infer<typeof UpdateDocumentSchema>;

export const DeleteDocumentSchema = z.object({ id: idSchema });

export type DeleteDocumentRequestDTO = z.infer<typeof DeleteDocumentSchema>;

// Which stored signature a staff member wants to open.
export const ViewSignatureSchema = z.object({ signatureId: idSchema });

export type ViewSignatureRequestDTO = z.infer<typeof ViewSignatureSchema>;

// -------------------------------------------------------------------
// One signable document.
//
// `signedCount` counts the people IN THE CALLER'S SCOPE who have signed the
// current version, so a manager's number describes their teams rather than the
// whole platform.
// -------------------------------------------------------------------
export type DocumentResponseDTO = {
  id: string;
  key: string;
  title: string;
  version: string;
  contentKey: SiteContentKey;
  isRequired: boolean;
  orderBy: number;
  isActive: boolean;
  signedCount: number;
};

// -------------------------------------------------------------------
// One person's standing against one document.
//
// The version fields are the SNAPSHOT taken at signing, not the document's
// values today - which is exactly what makes `isCurrent` meaningful.
// -------------------------------------------------------------------
export type SignerDocumentStatusDTO = {
  documentKey: string;
  documentTitle: string;
  documentVersion: string;
  signatureId: string | null;
  signedVersion: string | null;
  signedAt: Date | null;
  isCurrent: boolean;
  isRequired: boolean;
};

// -------------------------------------------------------------------
// One person on the signing overview.
// -------------------------------------------------------------------
export type DocumentSignerDTO = {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  // Empty when they are in no team - membership is optional in both directions.
  teamNames: string[];
  documents: SignerDocumentStatusDTO[];
  signedCount: number;
  // Required documents they have not signed at the current version.
  outstandingCount: number;
};

// -------------------------------------------------------------------
// Everything the staff documents screen renders in one pass.
// -------------------------------------------------------------------
export type AdminDocumentsDTO = {
  documents: DocumentResponseDTO[];
  signers: DocumentSignerDTO[];
  // True for an admin. Managers see the documents and their own teams' signing
  // status, but do not edit the document list itself.
  isUnrestricted: boolean;
};

// -------------------------------------------------------------------
// One stored signature, opened by a staff member.
//
// `signerName` and `signatureImage` are decrypted for this view. If they cannot
// be decrypted the request fails rather than returning blanks - a record that
// cannot be read must not be presented as one that can.
// -------------------------------------------------------------------
export type SignedDocumentDetailDTO = {
  documentTitle: string;
  documentVersion: string;
  // Sanitised HTML snapshot of exactly what was signed.
  documentContent: string;
  signerName: string;
  // The drawn signature, a PNG data URL.
  signatureImage: string;
  signedAt: Date;
  // The account's own name, so it can be read against the name they typed.
  accountName: string | null;
};
