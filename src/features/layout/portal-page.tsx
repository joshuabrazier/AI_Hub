import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// PortalPage
// Shared shell for authenticated portal screens (admin and client):
// consistent width, padding and a branded page header (eyebrow + title
// + description) with an optional actions slot. Set `eyebrow` to label
// the area, e.g. "Admin" or "Client". Use `size="narrow"` for centered
// form-style pages, `size="default"` for wide table/content pages.
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
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  size?: "default" | "narrow";
  fill?: boolean;
  headerHidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-4 sm:px-6 lg:px-10",
        // 5rem is the fixed navbar, the same offset CenteredTopLayout uses.
        fill ? "flex h-[calc(100dvh-5rem)] flex-col overflow-hidden pb-2" : "py-8",
        // With no header there is nothing to sit under, so the content starts
        // near the top rather than a header's distance down.
        fill && (headerHidden ? "pt-3" : "pt-6"),
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          size === "narrow" ? "max-w-2xl" : "max-w-7xl",
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
          <header className={cn("border-b border-border", fill ? "mb-4 shrink-0 pb-4" : "mb-8 pb-6")}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {eyebrow}
                </p>
                <h1 className="mt-1.5 font-heading text-3xl font-bold text-foreground">{title}</h1>
                {description && <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>}
              </div>

              {actions && <div className="shrink-0">{actions}</div>}
            </div>
          </header>
        )}

        {fill ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
      </div>
    </div>
  );
}
