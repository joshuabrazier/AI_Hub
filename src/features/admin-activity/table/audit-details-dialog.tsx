"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { AuditLogEntryDTO } from "../admin-activity.types";

// -------------------------------------------------------------------
// Shows exactly what a logged change altered: each field as before -> after,
// plus the request metadata captured with it. Read-only.
//
// Everything rendered here comes from the stored `changes` blob, which by
// convention holds only non-sensitive values - anything sensitive is recorded
// as the NAME of the field that changed and never its value, so there is
// nothing to decrypt or redact at this layer.
// -------------------------------------------------------------------
export function AuditDetailsDialog({
  entry,
  onOpenChange,
}: {
  entry: AuditLogEntryDTO | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle>{entry.actionLabel}</DialogTitle>
              <DialogDescription>
                {entry.createdAtLabel} · {entry.actorName}
                {entry.actorRole ? ` (${entry.actorRole})` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {entry.summary && <p className="text-sm text-foreground">{entry.summary}</p>}

              {(entry.subjectUserName || entry.teamName) && (
                <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
                  {entry.subjectUserName && (
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">Person</dt>
                      <dd className="text-foreground">{entry.subjectUserName}</dd>
                    </div>
                  )}
                  {entry.teamName && (
                    <div>
                      <dt className="text-xs font-medium uppercase text-muted-foreground">Team</dt>
                      <dd className="text-foreground">{entry.teamName}</dd>
                    </div>
                  )}
                </dl>
              )}

              {entry.fieldChanges.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Changes</h3>
                  <ul className="space-y-1.5">
                    {entry.fieldChanges.map((change) => (
                      <li key={change.label} className="text-sm">
                        <span className="font-medium text-foreground">{change.label}: </span>
                        <span className="text-muted-foreground line-through">{change.from || "(empty)"}</span>
                        <span className="mx-1 text-muted-foreground">-&gt;</span>
                        <span className="text-foreground">{change.to || "(empty)"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(entry.ipAddress || entry.userAgent) && (
                <div className="space-y-0.5 border-t border-border pt-3 text-xs text-muted-foreground">
                  {entry.ipAddress && <div>IP address: {entry.ipAddress}</div>}
                  {/* A user-agent string has no spaces to wrap on, so it has
                      to be allowed to break mid-word or it overflows. */}
                  {entry.userAgent && <div className="wrap-break-word">Device: {entry.userAgent}</div>}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
