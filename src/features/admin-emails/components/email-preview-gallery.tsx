"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

import { cn } from "@/lib/utils";

import type { EmailPreview } from "../admin-emails.data";

// -------------------------------------------------------------------
// EmailPreviewGallery
// A list of every email the app sends on the left; the selected one is
// rendered on the right in an isolated iframe (so the email's own table-based
// HTML and inline styles display exactly as they would in an inbox, without
// the app's CSS leaking in). The iframe auto-sizes to its content.
// -------------------------------------------------------------------
export function EmailPreviewGallery({ emails }: { emails: EmailPreview[] }) {
  const [selectedKey, setSelectedKey] = useState(emails[0]?.key ?? "");
  const [height, setHeight] = useState(640);

  const selected = emails.find((email) => email.key === selectedKey) ?? emails[0];
  if (!selected) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Left: choose an email to preview. */}
      <nav aria-label="Email templates" className="flex flex-col gap-2">
        {emails.map((email) => {
          const isActive = email.key === selected.key;
          return (
            <button
              key={email.key}
              type="button"
              onClick={() => setSelectedKey(email.key)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                isActive
                  ? "border-border bg-primary/5"
                  : "border-border hover:border-border/50 hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                <Mail size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                {email.name}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{email.audience}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: details + the rendered email. */}
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border border-border p-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject line</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">{selected.subject}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sent to</dt>
              <dd className="mt-0.5 text-sm text-foreground">{selected.audience}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">When it&apos;s sent</dt>
              <dd className="mt-0.5 text-sm text-foreground">{selected.trigger}</dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            Sample preview only. Names, links and details are placeholders, not real data.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <iframe
            key={selected.key}
            title={`${selected.name} email preview`}
            srcDoc={selected.html}
            sandbox="allow-same-origin"
            onLoad={(event) => {
              const body = event.currentTarget.contentDocument?.body;
              if (body) setHeight(body.scrollHeight + 8);
            }}
            style={{ height }}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
