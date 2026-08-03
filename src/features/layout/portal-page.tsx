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
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  size?: "default" | "narrow";
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className={cn("mx-auto", size === "narrow" ? "max-w-2xl" : "max-w-7xl")}>
        <header className="mb-8 border-b border-border pb-6">
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

        {children}
      </div>
    </div>
  );
}
