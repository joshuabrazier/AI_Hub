import z from "zod";

// -------------------------------------------------------------------
// Sign a document (member -> server)
//
// The document is named by its KEY, not by an enum member: signable documents
// are rows now, so a project can add one without a code change. The key is a
// lookup, never a grant - the service resolves it to an active document row and
// refuses anything else.
//
// The signature image is a PNG data URL from the signature pad.
// -------------------------------------------------------------------
export const SignDocumentSchema = z.object({
  documentKey: z.string().trim().min(1).max(255),
  signerName: z.string().trim().min(1, "Please enter your full name").max(100),
  signatureImage: z
    .string()
    .startsWith("data:image/png;base64,", "A signature is required")
    // Cap the payload so an oversized or pasted image cannot be stored. A drawn
    // signature PNG is well under this.
    .max(500_000, "Signature is too large - please try again"),
});

export type SignDocumentRequestDTO = z.infer<typeof SignDocumentSchema>;

// -------------------------------------------------------------------
// One document as its signer sees it.
//
// `signed` means signed AT THE CURRENT VERSION. `signedVersion` is what they
// actually put their name to, so a document that has moved on since can say
// "you signed version 1.0, please sign 2.0" rather than just "not signed".
//
// `content` is the wording to show: the exact text they signed once they have
// signed the current version, and the live wording while they have not. Showing
// the live text against an existing signature would quietly misrepresent what
// was agreed if the wording has been edited since.
// -------------------------------------------------------------------
export type MemberDocumentDTO = {
  id: string;
  key: string;
  title: string;
  version: string;
  content: string;
  isRequired: boolean;
  signed: boolean;
  signedAt: Date | null;
  signedVersion: string | null;
  // The name they signed with, and their drawn signature, decrypted for its
  // owner only. Null when unsigned, and also null when the stored value cannot
  // be decrypted - see the note on safeDecryptField in the service.
  signerName: string | null;
  signatureImage: string | null;
};

export type MemberDocumentsDTO = {
  documents: MemberDocumentDTO[];
  // Required documents not signed at the current version. Drives the "action
  // needed" line on the page.
  outstandingCount: number;
};
