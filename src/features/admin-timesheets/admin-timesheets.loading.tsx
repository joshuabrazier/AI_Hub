// -------------------------------------------------------------------
// The timesheet screens' loading state.
//
// This file is a PERFORMANCE fix as much as a visual one, and the
// performance half is the bigger of the two.
//
// The tab controls are Links so that Next can prefetch them - a button
// calling router.push cannot be prefetched, and every switch between week,
// month and year was a cold round trip to a database in another city. But a
// dynamic route with NO loading boundary has nothing cheap to prefetch, so
// Next answered each of those links by rendering the whole page on the
// server. One page load fired twenty-five prefetches, each a full render of
// roughly a dozen queries: about three hundred queries to look at one screen.
//
// The server then spent its time on pages nobody had asked for, which is why
// navigation was quick two or three times and then stalled - the connection
// pool was busy prefetching, and the router cache had evicted the entry that
// would have made the click instant.
//
// With a boundary here, an automatic prefetch stops at this skeleton instead
// of rendering the page behind it. The prefetch becomes nearly free, and the
// click still feels immediate because this renders the moment you press,
// rather than the browser sitting on the previous screen until the server
// answers. See transcription.loading.tsx, which hit the same thing.
//
// The shape below deliberately mirrors the real screen - header, filter bar,
// a row of tiles, a chart - so the page does not jump when the content lands.
// -------------------------------------------------------------------
export default function AdminTimesheetsLoading() {
  return (
    <div role="status" aria-label="Loading timesheets" className="animate-pulse space-y-6">
      {/* Title block. */}
      <div className="space-y-2">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-8 w-56 rounded-lg bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted" />
      </div>

      {/* Filter bar. */}
      <div className="h-14 rounded-xl border border-border bg-muted/20" />

      {/* Four headline tiles, at the height they actually settle to. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl border border-border bg-card">
            <div className="space-y-3 p-4">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-8 w-20 rounded bg-muted" />
              <div className="h-3 w-28 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>

      {/* The chart. */}
      <div className="h-80 rounded-xl border border-border bg-card">
        <div className="space-y-3 p-4">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-72 max-w-full rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
