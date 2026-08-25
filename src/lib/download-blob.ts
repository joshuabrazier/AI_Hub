// -------------------------------------------------------------------
// Hand a file to the browser to save.
//
// Browser-only, and deliberately not marked "use client" - this is a
// plain function, so it is the CALLER that has to be a client component.
// Anything that imported it from the server would fail on `document`,
// which is a clearer error than a silent no-op.
//
// Shared because two different things need it for the same reason: a
// transcript, and a recording whose upload failed. In both cases the bytes
// are already in the page and the alternative would be a second, separately
// guarded route out of the app for content that is already in front of the
// person asking for it.
// -------------------------------------------------------------------
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;

  // Appended before clicking. A detached anchor works in Chrome but not in
  // every browser, and this is the path somebody uses to rescue a recording
  // that would otherwise be lost - not the place to rely on a quirk.
  document.body.appendChild(link);
  link.click();
  link.remove();

  // The click has already been dispatched synchronously, so the object URL
  // has served its purpose. Revoking it releases the blob rather than
  // holding a copy of a large recording in memory for the life of the page.
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------------
// A filename that cannot decide what kind of file it is.
//
// The base is user-typed text - a meeting title - so everything outside a
// conservative set is replaced, and the extension is supplied separately by
// the caller rather than being anything the title could influence.
// -------------------------------------------------------------------
export function safeDownloadName(base: string, extension: string): string {
  const cleaned = base
    .replace(/[^a-zA-Z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return `${cleaned.length > 0 ? cleaned : "recording"}${extension}`;
}
