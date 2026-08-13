import { AI_CHAT_ATTACHMENT_KINDS, type AiChatAttachmentKind } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// What Bedrock Converse will accept as an attachment, and how to prove a
// file really is one.
//
// Every constant here comes from the Converse contract rather than from
// Anthropic's first-party API, and the two DIFFER - this is the list that
// matters, because this app talks to Bedrock:
//
//   images     gif, jpeg, png, webp   (ImageFormat in the AWS SDK)
//   documents  csv, doc, docx, html, md, pdf, txt, xls, xlsx
//                                     (DocumentFormat in the AWS SDK)
//
// Anything outside those two enums is rejected by the API, so accepting it
// here would only move the failure later. Video and audio blocks exist on
// the ContentBlock union but Claude does not take them: the Opus 4.6 model
// card lists Image and Text as its only input modalities.
//
// No import from @aws-sdk/client-bedrock-runtime: this module is reached
// from client components (for the file picker's accept list and the
// messages shown before an upload starts), and pulling the AWS SDK into a
// browser bundle to read two string unions would be a poor trade. The
// tables below are checked against the SDK enums by the unit tests, which
// DO import them - so a drift in either direction fails the build rather
// than the send.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Per-file limits, from the Converse quotas.
//
// An image is capped at 3.75 MB and 8000 px on either side; a document at
// 4.5 MB. These are the API's numbers, not ours - raising them here just
// moves the rejection from the composer to Bedrock.
// -------------------------------------------------------------------
export const MAX_IMAGE_BYTES = 3_932_160; // 3.75 MiB
export const MAX_DOCUMENT_BYTES = 4_718_592; // 4.5 MiB
export const MAX_IMAGE_PIXELS = 8_000;

// -------------------------------------------------------------------
// Per-REQUEST limits, which is what these really are.
//
// Bedrock counts these across the whole request, and every send in this app
// replays the entire conversation - so they are effectively limits on the
// CONVERSATION, not on one message. A thread that has accumulated 20 images
// cannot attach a 21st to its next turn while the earlier ones are still
// being replayed. buildConverseRequest is where that is enforced, by
// admitting attachments newest-first until the budget is spent.
//
// MAX_REQUEST_ATTACHMENT_BYTES is deliberately well under the 20 MB payload
// cap: the transcript text, the system prompt and the summary all share that
// budget, and a request rejected for size after the model call has started
// costs the user their turn.
// -------------------------------------------------------------------
export const MAX_IMAGES_PER_REQUEST = 20;
export const MAX_DOCUMENTS_PER_REQUEST = 5;
export const MAX_REQUEST_ATTACHMENT_BYTES = 16 * 1024 * 1024;

// -------------------------------------------------------------------
// The format tables.
//
// `mediaType` is what this app serves the file back as, and it is derived
// from the sniffed format - never from what the browser said at upload.
//
// html maps to text/plain ON PURPOSE. Serving an uploaded document as
// text/html would run its markup as a page on this app's own origin, which
// turns "attach a file" into stored XSS against the person who uploaded it.
// The model still receives it as an `html` document and reads it as markup;
// only the download is defanged.
// -------------------------------------------------------------------
export const AI_CHAT_IMAGE_FORMATS = {
  gif: { mediaType: "image/gif", extensions: [".gif"] },
  jpeg: { mediaType: "image/jpeg", extensions: [".jpg", ".jpeg"] },
  png: { mediaType: "image/png", extensions: [".png"] },
  webp: { mediaType: "image/webp", extensions: [".webp"] },
} as const;

export const AI_CHAT_DOCUMENT_FORMATS = {
  csv: { mediaType: "text/csv", extensions: [".csv"] },
  doc: { mediaType: "application/msword", extensions: [".doc"] },
  docx: {
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx"],
  },
  html: { mediaType: "text/plain", extensions: [".html", ".htm"] },
  md: { mediaType: "text/markdown", extensions: [".md", ".markdown"] },
  pdf: { mediaType: "application/pdf", extensions: [".pdf"] },
  txt: { mediaType: "text/plain", extensions: [".txt"] },
  xls: { mediaType: "application/vnd.ms-excel", extensions: [".xls"] },
  xlsx: {
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: [".xlsx"],
  },
} as const;

export type AiChatImageFormat = keyof typeof AI_CHAT_IMAGE_FORMATS;
export type AiChatDocumentFormat = keyof typeof AI_CHAT_DOCUMENT_FORMATS;
export type AiChatAttachmentFormat = AiChatImageFormat | AiChatDocumentFormat;

// The `accept` attribute for the file picker. A convenience for the user,
// not a control: the browser applies it, so it is advice and nothing more.
// Every check that matters runs server-side on the bytes.
export const AI_CHAT_ACCEPT_ATTRIBUTE = [
  ...Object.values(AI_CHAT_IMAGE_FORMATS).flatMap((entry) => entry.extensions),
  ...Object.values(AI_CHAT_DOCUMENT_FORMATS).flatMap((entry) => entry.extensions),
].join(",");

// A short human list for the composer's help text, so the UI and the
// allowlist cannot drift apart.
export const AI_CHAT_ACCEPTED_SUMMARY = "Images (PNG, JPEG, GIF, WebP), PDF, Office files, and text";

export function mediaTypeFor(format: AiChatAttachmentFormat): string {
  return format in AI_CHAT_IMAGE_FORMATS
    ? AI_CHAT_IMAGE_FORMATS[format as AiChatImageFormat].mediaType
    : AI_CHAT_DOCUMENT_FORMATS[format as AiChatDocumentFormat].mediaType;
}

export function kindFor(format: AiChatAttachmentFormat): AiChatAttachmentKind {
  return format in AI_CHAT_IMAGE_FORMATS
    ? AI_CHAT_ATTACHMENT_KINDS.IMAGE
    : AI_CHAT_ATTACHMENT_KINDS.DOCUMENT;
}

// -------------------------------------------------------------------
// Image header parsing.
//
// Each of these returns the pixel dimensions if the bytes really are that
// format, and null if they are not - so one function does double duty as
// the magic-byte check AND the size check, and the two can never disagree.
//
// Dimensions are read here rather than left to Bedrock because an image
// over 8000 px is refused by the API, and finding that out at send time
// means the user waited for a request that was never going to work.
// -------------------------------------------------------------------
type Dimensions = { width: number; height: number };

// 89 P N G \r \n 0x1A \n, then a 4-byte length and the IHDR tag, whose
// first two fields are the dimensions.
function readPng(bytes: Buffer): Dimensions | null {
  if (bytes.length < 24) return null;
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  if (bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// GIF87a / GIF89a, then the logical screen descriptor - little-endian,
// unlike almost every other format here.
function readGif(bytes: Buffer): Dimensions | null {
  if (bytes.length < 10) return null;

  const signature = bytes.subarray(0, 6).toString("latin1");
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;

  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

// SOI, then a walk over the segment chain to the first start-of-frame,
// which is the only segment carrying the dimensions. The frame markers are
// C0-CF EXCEPT C4 (Huffman tables), C8 (reserved) and CC (arithmetic
// coding conditioning) - those three are ordinary segments that happen to
// sit in the same range, and treating one as a frame reads two unrelated
// bytes as a height.
function readJpeg(bytes: Buffer): Dimensions | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;

  while (offset + 9 < bytes.length) {
    // Segments are byte-aligned with 0xFF; fill bytes are legal between them.
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];

    // Padding, and the standalone markers that carry no length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }

    const length = bytes.readUInt16BE(offset + 2);

    // A zero/short length would not advance and would spin here forever.
    if (length < 2) return null;

    offset += 2 + length;
  }

  return null;
}

// RIFF container with a WEBP fourcc, then one of three body chunks. All
// three store dimensions differently, and a file with none of them is not
// a WebP this code will vouch for.
function readWebp(bytes: Buffer): Dimensions | null {
  if (bytes.length < 30) return null;
  if (bytes.subarray(0, 4).toString("latin1") !== "RIFF") return null;
  if (bytes.subarray(8, 12).toString("latin1") !== "WEBP") return null;

  const chunk = bytes.subarray(12, 16).toString("latin1");

  // Lossy: a 3-byte frame tag, then the start code, then 14-bit dimensions.
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;

    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }

  // Lossless: a signature byte, then 14 bits of width and 14 of height
  // packed across the next four bytes, each stored one less than actual.
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;

    const packed = bytes.readUInt32LE(21);

    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
  }

  // Extended: canvas size as two 24-bit values, also stored one less.
  if (chunk === "VP8X") {
    const width = bytes.readUIntLE(24, 3) + 1;
    const height = bytes.readUIntLE(27, 3) + 1;

    return { width, height };
  }

  return null;
}

const IMAGE_READERS: Record<AiChatImageFormat, (bytes: Buffer) => Dimensions | null> = {
  png: readPng,
  jpeg: readJpeg,
  gif: readGif,
  webp: readWebp,
};

// -------------------------------------------------------------------
// Document sniffing.
//
// Three groups, and the confidence in each differs, so the rules differ:
//
//   PDF has a signature that identifies it outright.
//
//   The Office formats share a container - docx/xlsx are both ZIP,
//   doc/xls are both OLE2 - so the signature proves the CONTAINER and a
//   scan of the bytes picks the variant. Where the scan is inconclusive
//   the extension breaks the tie, which is safe here and only here:
//   both candidates are already on the allowlist, so the worst outcome is
//   a spreadsheet labelled as a document and a Bedrock validation error.
//   The extension never gets to decide whether a file is admitted.
//
//   The text formats have no signature at all. They are admitted on proof
//   that the bytes are valid UTF-8 with no NULs - which is what rules out a
//   binary wearing a .txt - and the extension then picks among four
//   formats that are handled identically on the way back out.
// -------------------------------------------------------------------
// ZIP local-file-header lead bytes. All three ZIP variants begin "PK"; the
// byte after distinguishes them, and any of the three is a container worth
// looking inside.
const ZIP_LEAD = Buffer.from([0x50, 0x4b]);
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function startsWith(bytes: Buffer, signature: string): boolean {
  return bytes.subarray(0, signature.length).toString("latin1") === signature;
}

// "PK" followed by 03/05/06 (local header), 05/06 (empty) or 07/08
// (spanned). Checking the third byte as well keeps a text file that merely
// happens to start with those two letters out.
function isZipContainer(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  if (!bytes.subarray(0, 2).equals(ZIP_LEAD)) return false;

  return bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07;
}

// ZIP entry names sit in the archive as plain text, so the parts that
// identify an OOXML package are findable without unzipping it.
function scanFor(bytes: Buffer, needles: string[]): boolean {
  const haystack = bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString("latin1");

  return needles.some((needle) => haystack.includes(needle));
}

// OLE2 stream names are stored UTF-16LE in the directory, so the ASCII
// scan above would miss them.
function scanForWide(bytes: Buffer, needles: string[]): boolean {
  const haystack = bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString("utf16le");

  return needles.some((needle) => haystack.includes(needle));
}

function isValidUtf8Text(bytes: Buffer): boolean {
  // A NUL is the giveaway for a binary file renamed to .txt; no valid text
  // document contains one.
  if (bytes.includes(0x00)) return false;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");

  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

function documentFormatForExtension(extension: string): AiChatDocumentFormat | null {
  for (const [format, entry] of Object.entries(AI_CHAT_DOCUMENT_FORMATS)) {
    if ((entry.extensions as readonly string[]).includes(extension)) {
      return format as AiChatDocumentFormat;
    }
  }

  return null;
}

// -------------------------------------------------------------------
// The result of inspecting an upload.
//
// A rejection carries a `reason` written for the person who chose the
// file, because it is shown to them verbatim. It never echoes the
// filename back - that string is attacker-controlled and would be
// rendering untrusted input inside an error message.
// -------------------------------------------------------------------
export type AttachmentInspection =
  | {
      ok: true;
      kind: AiChatAttachmentKind;
      format: AiChatAttachmentFormat;
      mediaType: string;
      width: number | null;
      height: number | null;
    }
  | { ok: false; reason: string };

// -------------------------------------------------------------------
// Decide what an uploaded file is, from its bytes.
//
// The filename is an input to exactly two decisions - which text format,
// and which Office variant - and to nothing else. In particular it never
// decides WHETHER a file is accepted, and the browser's Content-Type is
// not consulted at all: both are client-controlled, and treating either as
// evidence is how an executable gets stored as a png.
// -------------------------------------------------------------------
export function inspectAttachment(bytes: Buffer, fileName: string): AttachmentInspection {
  if (bytes.length === 0) {
    return { ok: false, reason: "That file is empty." };
  }

  const extension = extensionOf(fileName);

  // Images first: the readers prove the format and measure it in one pass.
  for (const [format, read] of Object.entries(IMAGE_READERS)) {
    const dimensions = read(bytes);
    if (!dimensions) continue;

    const imageFormat = format as AiChatImageFormat;

    if (bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, reason: `Images must be under ${formatBytes(MAX_IMAGE_BYTES)}.` };
    }

    if (dimensions.width > MAX_IMAGE_PIXELS || dimensions.height > MAX_IMAGE_PIXELS) {
      return {
        ok: false,
        reason: `Images must be no more than ${MAX_IMAGE_PIXELS} pixels on either side. That one is ${dimensions.width} by ${dimensions.height}.`,
      };
    }

    // A header can decode cleanly and still describe nothing.
    if (dimensions.width === 0 || dimensions.height === 0) {
      return { ok: false, reason: "That image appears to be damaged." };
    }

    return {
      ok: true,
      kind: AI_CHAT_ATTACHMENT_KINDS.IMAGE,
      format: imageFormat,
      mediaType: AI_CHAT_IMAGE_FORMATS[imageFormat].mediaType,
      width: dimensions.width,
      height: dimensions.height,
    };
  }

  const documentFormat = sniffDocumentFormat(bytes, extension);

  if (!documentFormat) {
    return {
      ok: false,
      reason: `That file type is not supported. You can attach ${AI_CHAT_ACCEPTED_SUMMARY.toLowerCase()}.`,
    };
  }

  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: `Documents must be under ${formatBytes(MAX_DOCUMENT_BYTES)}.` };
  }

  return {
    ok: true,
    kind: AI_CHAT_ATTACHMENT_KINDS.DOCUMENT,
    format: documentFormat,
    mediaType: AI_CHAT_DOCUMENT_FORMATS[documentFormat].mediaType,
    width: null,
    height: null,
  };
}

function sniffDocumentFormat(bytes: Buffer, extension: string): AiChatDocumentFormat | null {
  if (startsWith(bytes, "%PDF-")) return "pdf";

  // OOXML: a ZIP whose entries name the part of the package they belong to.
  if (isZipContainer(bytes)) {
    if (scanFor(bytes, ["word/document.xml", "word/_rels"])) return "docx";
    if (scanFor(bytes, ["xl/workbook.xml", "xl/_rels"])) return "xlsx";

    // A ZIP that is one of the two but does not say so in the first 64 KB.
    return extension === ".docx" ? "docx" : extension === ".xlsx" ? "xlsx" : null;
  }

  // Legacy Office: one compound-file container for both, distinguished by
  // the name of the stream holding the actual content.
  if (bytes.subarray(0, 8).equals(OLE2_SIGNATURE)) {
    if (scanForWide(bytes, ["WordDocument"])) return "doc";
    if (scanForWide(bytes, ["Workbook", "Book"])) return "xls";

    return extension === ".doc" ? "doc" : extension === ".xls" ? "xls" : null;
  }

  // Everything left has to earn its place by being genuine text.
  const byExtension = documentFormatForExtension(extension);

  if (byExtension && ["csv", "html", "md", "txt"].includes(byExtension) && isValidUtf8Text(bytes)) {
    return byExtension;
  }

  return null;
}

// -------------------------------------------------------------------
// A document name Bedrock will accept.
//
// The API restricts this field to alphanumerics, single whitespace,
// hyphens, parentheses and square brackets - so most real filenames need
// rewriting, and one that rewrites to nothing needs a fallback.
//
// AWS's own note on the field: "This field is vulnerable to prompt
// injections, because the model might inadvertently interpret it as
// instructions." The charset above is narrow but not harmless - a
// sentence survives it intact. It is passed through anyway, for one
// reason: the file arrived in the uploader's OWN private conversation,
// alongside message text they also control and which is already sent
// verbatim. There is no second party's data in that context and no tool
// the model can reach, so a name that reads as an instruction can only
// influence an answer to the person who wrote it.
//
// That reasoning is worth re-checking if this feature ever gains tools,
// shared conversations, or anything that acts on a reply automatically -
// at which point a neutral positional name is the safer default.
// -------------------------------------------------------------------
export function sanitizeDocumentName(fileName: string, position: number): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");

  const cleaned = withoutExtension
    // Everything outside the permitted set becomes a space rather than
    // being dropped, so "report_final.pdf" stays two readable words.
    .replace(/[^a-zA-Z0-9\s\-()[\]]/g, " ")
    // "No more than one in a row" is a hard rule, not a preference.
    .replace(/\s+/g, " ")
    .trim()
    // Long enough to stay recognisable, short enough not to become a
    // paragraph of model input.
    .slice(0, 64)
    .trim();

  return cleaned.length > 0 ? cleaned : `Document ${position}`;
}

// -------------------------------------------------------------------
// Byte sizes for people. Used in validation messages and in the composer,
// so both describe the same limit the same way.
// -------------------------------------------------------------------
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;

  const megabytes = kilobytes / 1024;

  // One decimal below 10 MB, where the difference between 3.7 and 4.5
  // is the difference between accepted and rejected.
  return megabytes < 10 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
}
