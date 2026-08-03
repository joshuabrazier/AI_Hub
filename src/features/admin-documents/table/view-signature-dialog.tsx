"use client";

import { useRef, useState } from "react";
import { format } from "date-fns";
import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { getSignedDocumentAction } from "../admin-documents.actions";
import type { DocumentSignerDTO, SignedDocumentDetailDTO, SignerDocumentStatusDTO } from "../admin-documents.types";

// The one-line standing for a document: signed at the current version, signed
// at an older one, or never.
function statusFor(status: SignerDocumentStatusDTO) {
  if (status.isCurrent) return <Badge variant="success">Signed</Badge>;
  if (status.signedVersion !== null) return <Badge variant="destructive">v{status.signedVersion}</Badge>;
  return <Badge variant={status.isRequired ? "destructive" : "secondary"}>Not signed</Badge>;
}

// -------------------------------------------------------------------
// ViewSignatureDialog
//
// One person's standing against every document on offer, and - for the ones
// they have signed - the exact text they signed, with their name and drawn
// signature.
//
// The signature is fetched on demand rather than shipped with the table: it is
// encrypted personal data, so it is read one record at a time, by an explicit
// action, with the caller's scope re-checked server-side each time.
// -------------------------------------------------------------------
export function ViewSignatureDialog({ signer }: { signer: DocumentSignerDTO }) {
  const [open, setOpen] = useState(false);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SignedDocumentDetailDTO | null>(null);
  // Guards against a slower earlier response overwriting a newer selection.
  const latestRequest = useRef(0);

  const reset = () => {
    latestRequest.current += 1;
    setSelectedSignatureId(null);
    setDetail(null);
    setError(null);
    setLoading(false);
  };

  const loadSignature = (signatureId: string) => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    setSelectedSignatureId(signatureId);
    setLoading(true);
    setError(null);
    setDetail(null);

    getSignedDocumentAction({ signatureId })
      .then((response) => {
        if (requestId !== latestRequest.current) return;

        if (!response.success) {
          // A signature that will not decrypt reports exactly that, rather than
          // rendering an empty panel that reads as "never signed".
          setError(response.formError ?? "Could not open that signature.");
          return;
        }

        setDetail(response.data);
      })
      .catch(() => {
        if (requestId === latestRequest.current) setError("Could not open that signature.");
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false);
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="size-4" aria-hidden="true" />
          View
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Signed documents</DialogTitle>
          <DialogDescription>
            {signer.name} · {signer.email}
          </DialogDescription>
        </DialogHeader>

        <ul className="shrink-0 divide-y divide-border rounded-lg border border-border">
          {signer.documents.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">There are no documents on offer.</li>
          ) : (
            signer.documents.map((status) => (
              <li key={status.documentKey} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{status.documentTitle}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {status.signedAt
                      ? `Signed ${format(status.signedAt, "d MMM yyyy")} against version ${status.signedVersion}`
                      : `Current version ${status.documentVersion}`}
                  </p>
                </div>

                {statusFor(status)}

                {status.signatureId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selectedSignatureId === status.signatureId}
                    onClick={() => loadSignature(status.signatureId as string)}
                  >
                    Open
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border p-4">
          {!selectedSignatureId ? (
            <p className="text-sm text-muted-foreground">
              Open a signed document to see the exact text that was signed.
            </p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : detail ? (
            <article>
              <h3 className="font-heading text-lg font-bold text-foreground">{detail.documentTitle}</h3>
              <p className="text-xs text-muted-foreground">Version {detail.documentVersion}</p>

              {/* The snapshot is sanitised server-side on the way out. */}
              <div
                className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-foreground [&_h3]:mt-3 [&_h3]:font-bold [&_h3]:text-foreground [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
                dangerouslySetInnerHTML={{ __html: detail.documentContent }}
              />

              <div className="mt-6 space-y-3 border-t border-border pt-6">
                <p className="text-sm text-muted-foreground">
                  Signed by {detail.signerName} on {format(detail.signedAt, "d MMMM yyyy")}.
                </p>
                {/* The typed name and the account name can legitimately differ,
                    so both are shown rather than one being assumed correct. */}
                {detail.accountName && detail.accountName !== detail.signerName && (
                  <p className="text-xs text-muted-foreground">Account name: {detail.accountName}</p>
                )}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Signature</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the signature is a stored PNG data URL, not a static asset */}
                  <img
                    src={detail.signatureImage}
                    alt={`Signature of ${detail.signerName}`}
                    className="h-24 w-auto max-w-full rounded-md border border-border bg-white p-2"
                  />
                </div>
              </div>
            </article>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
