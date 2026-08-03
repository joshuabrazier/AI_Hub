import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// NotificationBody
// Renders a notification's rich-text body. The HTML is sanitised with a strict
// allow-list at write time (sendNotificationService) and again at read time
// (getMyNotificationsService and the sent history) - so the value reaching this
// component has always passed a server-side sanitiser, never the client editor
// alone. This component is therefore client-safe (no server-only imports),
// which the two-pane views need since they are client components.
// -------------------------------------------------------------------
export function NotificationBody({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-foreground",
        "[&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-bold",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_strong]:font-semibold [&_p]:my-2",
        "[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
