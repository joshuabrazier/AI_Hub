// -------------------------------------------------------------------
// The transcription screen's loading state.
//
// WHY THIS FILE EXISTS AT ALL, because its absence is a real bug rather
// than a missing nicety. The App Router shows a loading fallback from the
// CLOSEST boundary to the segments that are changing. There is a
// `loading.tsx` at the root, but navigating from /admin/ai-chat to
// /admin/transcription changes only the last segment, so the root boundary
// never comes into play - and with no boundary here, Next waits for the
// server before it navigates at all.
//
// The visible result is that clicking "Transcription" appears to do
// nothing: the browser sits on whatever page you were already looking at,
// for as long as the server takes, and then jumps. It reads as the link
// being broken, or as the app opening the wrong page.
//
// One file per area under app/, each re-exporting this, so the three
// mountings cannot drift apart.
// -------------------------------------------------------------------
export default function TranscriptionLoading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      {/* Mirrors the real two-column shell, so the page does not jump
          sideways when the content arrives. */}
      <div className="h-10 rounded-lg bg-muted" />

      <div
        role="status"
        aria-label="Loading transcriptions"
        className="flex min-h-64 items-center justify-center rounded-xl border border-border"
      >
        <div className="size-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </div>
  );
}
