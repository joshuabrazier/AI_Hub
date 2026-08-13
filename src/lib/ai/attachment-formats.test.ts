import { DocumentFormat, ImageFormat } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";

import {
  AI_CHAT_DOCUMENT_FORMATS,
  AI_CHAT_IMAGE_FORMATS,
  MAX_IMAGE_PIXELS,
  formatBytes,
  inspectAttachment,
  sanitizeDocumentName,
} from "./attachment-formats";

// -------------------------------------------------------------------
// Builders for the smallest bytes that are still a real header. Nothing
// here is a fixture file: the point is that the parser is reading the
// header, so the header is what the test writes.
// -------------------------------------------------------------------
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(10);
  bytes.write("GIF89a", 0, "latin1");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

// SOI, then a JFIF APP0 the walker has to step over, then the SOF0 that
// actually carries the dimensions. The skipped segment is the point: a
// parser that reads the first FFxx it sees gets this wrong.
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  app0.write("JFIF\0", 4, "latin1");

  const sof0 = Buffer.alloc(11);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(9, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.alloc(8)]);
}

function webpLossy(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "latin1");
  bytes.write("WEBP", 8, "latin1");
  bytes.write("VP8 ", 12, "latin1");
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  bytes.writeUInt16LE(width, 26);
  bytes.writeUInt16LE(height, 28);
  return bytes;
}

// A ZIP whose entry names identify the OOXML package, which is how a docx
// is told from an xlsx without unzipping it.
function ooxml(part: string): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(part, "latin1")]);
}

describe("the format tables match what Bedrock Converse accepts", () => {
  // The tables are hand-written so that client components can import them
  // without pulling in the AWS SDK. These two assertions are what keep that
  // copy honest - a format added to or removed from the SDK fails here
  // rather than at send time.
  it("covers exactly the SDK's ImageFormat enum", () => {
    expect(Object.keys(AI_CHAT_IMAGE_FORMATS).sort()).toEqual(Object.values(ImageFormat).sort());
  });

  it("covers exactly the SDK's DocumentFormat enum", () => {
    expect(Object.keys(AI_CHAT_DOCUMENT_FORMATS).sort()).toEqual(Object.values(DocumentFormat).sort());
  });
});

describe("inspectAttachment reads the format from the bytes", () => {
  it("identifies and measures each image format", () => {
    expect(inspectAttachment(png(800, 600), "a.png")).toMatchObject({
      ok: true,
      kind: "image",
      format: "png",
      width: 800,
      height: 600,
    });

    expect(inspectAttachment(gif(120, 90), "a.gif")).toMatchObject({ format: "gif", width: 120, height: 90 });

    expect(inspectAttachment(jpeg(1024, 768), "a.jpg")).toMatchObject({
      format: "jpeg",
      width: 1024,
      height: 768,
    });

    expect(inspectAttachment(webpLossy(640, 480), "a.webp")).toMatchObject({
      format: "webp",
      width: 640,
      height: 480,
    });
  });

  it("ignores the filename when the bytes say otherwise", () => {
    // The single most important case here: a file the browser and the
    // extension both call a PNG, whose content is markup. Admitting it
    // would store HTML that a later download could be talked into
    // rendering on this app's own origin.
    const markup = Buffer.from("<html><script>alert(1)</script></html>", "utf8");

    expect(inspectAttachment(markup, "totally-an-image.png")).toMatchObject({ ok: false });

    // And the reverse: a real PNG with a misleading name is still a PNG.
    expect(inspectAttachment(png(10, 10), "invoice.pdf")).toMatchObject({ ok: true, format: "png" });
  });

  it("refuses an image past the pixel cap rather than letting Bedrock do it", () => {
    const result = inspectAttachment(png(MAX_IMAGE_PIXELS + 1, 100), "huge.png");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(String(MAX_IMAGE_PIXELS));
  });

  it("refuses an empty file", () => {
    expect(inspectAttachment(Buffer.alloc(0), "empty.txt")).toMatchObject({ ok: false });
  });

  it("identifies documents by signature", () => {
    expect(inspectAttachment(Buffer.from("%PDF-1.7\n...", "latin1"), "report.pdf")).toMatchObject({
      ok: true,
      kind: "document",
      format: "pdf",
    });

    expect(inspectAttachment(ooxml("word/document.xml"), "notes.docx")).toMatchObject({ format: "docx" });
    expect(inspectAttachment(ooxml("xl/workbook.xml"), "budget.xlsx")).toMatchObject({ format: "xlsx" });
  });

  it("admits text only when it really is text", () => {
    expect(inspectAttachment(Buffer.from("a,b,c\n1,2,3", "utf8"), "data.csv")).toMatchObject({
      ok: true,
      format: "csv",
    });

    // A NUL byte is what a binary renamed to .txt looks like.
    expect(inspectAttachment(Buffer.from([0x41, 0x00, 0x42]), "sneaky.txt")).toMatchObject({ ok: false });

    // Invalid UTF-8 is the other giveaway.
    expect(inspectAttachment(Buffer.from([0xff, 0xfe, 0xfd]), "sneaky.md")).toMatchObject({ ok: false });
  });

  it("rejects a type that is on neither list", () => {
    // A well-formed ELF binary: real magic bytes, not on the allowlist.
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

    expect(inspectAttachment(elf, "payload.bin")).toMatchObject({ ok: false });
    expect(inspectAttachment(elf, "payload.pdf")).toMatchObject({ ok: false });
  });
});

describe("sanitizeDocumentName keeps names inside the character set Bedrock allows", () => {
  // Alphanumerics, single whitespace, hyphens, parentheses and square
  // brackets. Anything else is a validation error from the API.
  const permitted = /^[a-zA-Z0-9\s\-()[\]]+$/;

  it("strips the extension and anything outside the permitted set", () => {
    const name = sanitizeDocumentName("Q3_report@final!.pdf", 1);

    expect(name).toMatch(permitted);
    expect(name).toBe("Q3 report final");
  });

  it("never leaves two whitespace characters in a row", () => {
    expect(sanitizeDocumentName("a___b\t\t\tc.docx", 1)).toBe("a b c");
  });

  it("falls back to a positional name when nothing survives", () => {
    expect(sanitizeDocumentName("表.pdf", 3)).toBe("Document 3");
    expect(sanitizeDocumentName(".pdf", 1)).toBe("Document 1");
  });

  it("bounds the length so a filename cannot become a paragraph of input", () => {
    expect(sanitizeDocumentName(`${"a".repeat(500)}.pdf`, 1).length).toBeLessThanOrEqual(64);
  });
});

describe("formatBytes", () => {
  it("keeps a decimal where the limit is decided", () => {
    // 3.75 MB is a cap; rounding it to "4 MB" in an error message would
    // describe a limit that does not exist.
    expect(formatBytes(3_932_160)).toBe("3.8 MB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
  });
});
