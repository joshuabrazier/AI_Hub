import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// PortalPage
// Shared shell for authenticated portal screens (admin and client):
// consistent width, padding and a branded page header (eyebrow + title
// + description) with an optional actions slot. Set `eyebrow` to label
// the area, e.g. "Admin" or "Client". Use `size="narrow"` for centered
// form-style pages, `size="default"` for wide table/content pages.
//
// `size="full"` is EDGE TO EDGE: no max width and no gutters. It is for a
// screen that is a WORKSPACE rather than a document - one that owns its own
// internal columns and measures its own reading width, so both the cap and
// the padding out here only strand it in the middle of the window. The chat
// is the case it was added for: max-w-7xl put a 400px gap to the left of the
// conversation list, and the gutters then drew the whole thing as a card
// floating on the page rather than as the screen it is. Do not reach for it
// to make a table or a form wider - those want the cap and the gutters.
//
// It expects `headerHidden`. A full page with a visible header would run the
// eyebrow and title flush into the window edge, which is not a look anything
// here wants; if a workspace ever needs a header, give the header its own
// gutters rather than handing the gutters back to the whole page.
// -------------------------------------------------------------------
export default function PortalPage({
  eyebrow = "Admin",
  title,
  description,
  actions,
  size = "default",
  // -----------------------------------------------------------------
  // FILL: the page is exactly as tall as the space under the navbar, and
  // does not scroll. Its children own the scrolling instead.
  //
  // For a screen whose bottom edge is a control rather than the end of the
  // content - a chat composer, most obviously. Without this the page grows
  // past the viewport and the composer sits below the fold, so writing a
  // message means scrolling the whole page down to find the box first.
  //
  // The alternative was a magic height on the child (h-[calc(100vh-14rem)]),
  // which has to guess the navbar, this component's padding, and a header
  // whose height changes with the length of the description. It was wrong,
  // and it would have gone wrong again the next time any of those changed.
  // Here the chain is real: fixed height, min-h-0, flex-1.
  //
  // dvh rather than vh because on mobile the browser chrome shows and hides,
  // and vh keeps the tallest measurement - which puts the composer under the
  // address bar exactly when the keyboard is open.
  // -----------------------------------------------------------------
  fill = false,
  // -----------------------------------------------------------------
  // HIDE THE HEADER, but not the heading.
  //
  // For a screen where the content IS the page and the header is only
  // repeating what the sidebar already says. On the chat, the eyebrow, the
  // title and the description came to about 140px at the top of a page whose
  // whole job is the transcript underneath them.
  //
  // The h1 SURVIVES, screen-reader-only. A page with no h1 has no accessible
  // name and no document outline, which is a real regression for anybody
  // navigating by headings - and it is invisible to everyone else, so it is
  // exactly the kind of thing that gets dropped by accident. Hiding it
  // visually is a layout decision; removing it is not.
  // -----------------------------------------------------------------
  headerHidden = false,
  // -----------------------------------------------------------------
  // THE ONE FIGURE THIS SCREEN IS ABOUT.
  //
  // Optional, and worth passing only when the screen genuinely has a single
  // headline quantity - hours logged against hours sold, the week's total.
  // A count of rows in a table is not one: the table says that, and putting
  // it up here would be the header decorating itself.
  //
  // `value` is pre-formatted. Nothing here divides by sixty or picks a
  // decimal - the callers already own one answer to that each.
  // -----------------------------------------------------------------
  metric,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  metric?: { value: string; label: string; tone?: "default" | "caution" };
  size?: "default" | "narrow" | "full";
  fill?: boolean;
  headerHidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // Gutters, unless the page is edge to edge - see the note at the top.
        size !== "full" && "px-4 sm:px-6 lg:px-10",
        // --nav-h is the fixed navbar, the same token CenteredTopLayout uses.
        fill ? "flex h-[calc(100dvh-var(--nav-h))] flex-col overflow-hidden" : "py-8",
        // With no header there is nothing to sit under, so the content starts
        // near the top rather than a header's distance down. An edge-to-edge
        // page starts at the top itself, and its own bottom edge is a control
        // with its own spacing, so it takes neither.
        fill && size !== "full" && (headerHidden ? "pt-3 pb-2" : "pt-6 pb-2"),
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          size === "narrow" && "max-w-2xl",
          size === "default" && "max-w-7xl",
          // "full" gets no cap at all - see the note at the top.
          size === "full" && "max-w-none",
          fill && "flex min-h-0 flex-1 flex-col",
        )}
      >
        {headerHidden ? (
          // The heading itself, kept for the outline. Any actions still need
          // somewhere to go, so they get a bare row rather than vanishing.
          <>
            <h1 className="sr-only">{title}</h1>
            {actions && <div className="mb-3 flex shrink-0 justify-end">{actions}</div>}
          </>
        ) : (
          // -----------------------------------------------------------
          // THE HEADER, AND WHAT CAME OUT OF IT.
          //
          // It was an uppercase eyebrow, a 3xl bold title, a full-size
          // description and a 6-unit gap above a border - about 150px on
          // every screen, on top of the chrome above it. Combined with an
          // 80px navbar and the rail's own 56px header, a third of a laptop
          // window went by before the first row of data.
          //
          // THE EYEBROW ONLY SHOWS WHERE IT SAYS ANYTHING. It reads "Admin"
          // or "Client" - which the rail already says, permanently, two
          // inches to the left. Below `md` the rail is a sheet and there is
          // nothing on screen naming the area, so that is exactly where it
          // earns its line and the only place it renders.
          //
          // THE TITLE IS 2XL SEMIBOLD, NOT 3XL BOLD. A 3xl bold heading over
          // a muted paragraph is the stock dashboard header, and it competes
          // with the content for the eye on a screen whose content is the
          // point. Tighter type plus a figure that means something is what
          // makes a working instrument look considered.
          //
          // THE METRIC IS THE HEADER'S REASON TO BE THAT TALL. Every screen
          // here is a quantity against an allowance - hours logged of hours
          // sold, time in a week - and each of them used to render that as a
          // separate widget below the header, so the header itself carried no
          // information at all. Set in the mono face, which this palette's
          // own note reserves for "every figure that lines up in a column".
          // -----------------------------------------------------------
          <header className={cn("border-b border-border", fill ? "mb-4 shrink-0 pb-3" : "mb-6 pb-4")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="font-mono text-[0.625rem] font-medium tracking-[0.18em] text-muted-foreground uppercase md:hidden">
                  {eyebrow}
                </p>
                <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                {description && (
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
                )}
              </div>

              {(metric || actions) && (
                <div className="flex shrink-0 items-center gap-5">
                  {metric && (
                    <div className="text-right">
                      <p
                        className={cn(
                          "font-mono text-xl leading-none font-semibold tabular-nums",
                          metric.tone === "caution" ? "text-data-caution" : "text-foreground",
                        )}
                      >
                        {metric.value}
                      </p>
                      <p className="mt-1 font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
                        {metric.label}
                      </p>
                    </div>
                  )}

                  {actions && <div className="shrink-0">{actions}</div>}
                </div>
              )}
            </div>
          </header>
        )}

        {fill ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
      </div>
    </div>
  );
}
