"use client";

import { type ReactNode, useState, useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signDocumentAction } from "../documents.actions";
import type { MemberDocumentDTO } from "../documents.types";
import { SignaturePad } from "./signature-pad";

// -------------------------------------------------------------------
// SignDocumentDialog
//
// Opens a document for reading and, when a signature is due, takes a name and a
// drawn signature. An already-signed document shows the record instead: what
// was signed, by whom, and when.
//
// The wording is rendered on the server and passed in as children, so the
// sanitiser never has to run in the browser.
// -------------------------------------------------------------------
export function SignDocumentDialog({
  doc,
  children,
  onSigned,
}: {
  doc: MemberDocumentDTO;
  children: ReactNode;
  // Called after a successful sign. The portal relies on revalidation; a
  // multi-step flow can use this to track progress.
  onSigned?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const today = format(new Date(), "d MMMM yyyy");

  // Both are required: a typed name and a drawn signature.
  const canSign = signerName.trim().length > 0 && Boolean(signatureImage);

  // A document signed against an older version needs signing again, so the
  // signing form is what opens - with a line saying why.
  const needsResign = !doc.signed && doc.signedVersion !== null;

  const handleSign = () => {
    if (isPending) return;

    if (!signerName.trim()) {
      toast.error("Please enter your full name");
      return;
    }

    if (!signatureImage) {
      toast.error("Please draw your signature");
      return;
    }

    startTransition(async () => {
      const response = await signDocumentAction({
        documentKey: doc.key,
        signerName: signerName.trim(),
        signatureImage,
      });

      if (!response.success) {
        toast.error(response.formError ?? "Something went wrong. Please try again.");
        return;
      }

      toast.success(`${doc.title} signed`);
      setOpen(false);
      onSigned?.();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={doc.signed ? "outline" : "default"} size="sm">
          {doc.signed ? "View" : "Review and sign"}
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doc.title}</DialogTitle>
          <DialogDescription>Version {doc.version}</DialogDescription>
        </DialogHeader>

        {/* One scroll area: read the document, then scroll on to sign it. */}
        <div className="flex-1 overflow-y-auto pr-1">
          {children}

          {doc.signed ? (
            <div className="mt-6 space-y-3 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">
                Signed{doc.signerName ? ` by ${doc.signerName}` : ""}
                {doc.signedAt ? ` on ${format(doc.signedAt, "d MMMM yyyy")}` : ""}.
              </p>
              {doc.signatureImage ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Signature</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the signature is a stored PNG data URL, not a static asset */}
                  <img
                    src={doc.signatureImage}
                    alt={doc.signerName ? `Signature of ${doc.signerName}` : "Signature"}
                    className="h-24 w-auto max-w-full rounded-md border border-border bg-white p-2"
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your signature image cannot be displayed at the moment. The record of your signing is
                  unaffected.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-6 space-y-4 border-t border-border pt-6">
              <h3 className="font-heading text-base font-bold">Sign this document</h3>

              {needsResign && (
                <p className="text-sm text-muted-foreground">
                  You signed version {doc.signedVersion}. This document has been updated since, so
                  please read it again and sign version {doc.version}.
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="signerName">Full name</Label>
                <Input
                  id="signerName"
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label>Signature</Label>
                <SignaturePad onChange={setSignatureImage} disabled={isPending} />
              </div>

              <p className="text-sm text-muted-foreground">Date: {today}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Close
            </Button>
          </DialogClose>
          {!doc.signed && (
            <Button type="button" onClick={handleSign} loading={isPending} disabled={isPending || !canSign}>
              {isPending ? "Signing..." : "Sign document"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
