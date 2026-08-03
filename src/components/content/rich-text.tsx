import { cn } from "@/lib/utils";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";

// -------------------------------------------------------------------
// RichText
// Renders admin-authored HTML (from the TipTap rich-text editor) on
// public pages. The HTML is sanitised server-side with a strict
// allow-list before rendering, so stored content can never introduce
// scripts, event handlers or unsafe URLs (defence-in-depth: never trust
// the client editor to be the only guard). Server component only.
// -------------------------------------------------------------------
export default function RichText({ html, className }: { html: string; className?: string }) {
  const clean = sanitizeRichText(html);

  return (
    <div
      className={cn(
        "space-y-4 text-lg leading-relaxed text-muted-foreground",
        "[&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-foreground",
        "[&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-foreground",
        "[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-foreground",
        "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6",
        "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6",
        "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
