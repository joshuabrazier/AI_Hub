"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { beginTwoFactorEnrolmentAction } from "../two-factor.actions";
import type { TwoFactorEnrolmentDTO } from "../two-factor.types";
import { TwoFactorVerifyForm } from "./two-factor-verify-form";

// -------------------------------------------------------------------
// First-time setup: scan, save the backup codes, confirm a code.
//
// The secret is generated on mount rather than behind a button, because
// there is nothing to decide - somebody who reached this screen has to
// enrol before they can go anywhere. The guard below stops React's
// development double-render generating two secrets and leaving the QR the
// person just scanned pointing at the discarded one.
// -------------------------------------------------------------------
export function TwoFactorEnrol({ email }: { email: string }) {
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolmentDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const response = await beginTwoFactorEnrolmentAction();

      if (!response.success) {
        setError(response.formError ?? "We could not start two-factor setup.");
        return;
      }

      setEnrolment(response.data);
    })();
  }, []);

  if (error) {
    return (
      <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!enrolment) {
    return <p className="mt-6 text-sm text-muted-foreground">Preparing your setup code...</p>;
  }

  // The backup codes are shown once and are not retrievable afterwards, so
  // the person has to say they have them before the screen moves on. This
  // is the only chance they get.
  if (!codesAcknowledged) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Save your backup codes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These are the only way back in if you lose your phone. Each one works once. We cannot
            show them again.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-4 font-mono text-sm">
          {enrolment.backupCodes.map((backupCode) => (
            <li key={backupCode}>{backupCode}</li>
          ))}
        </ul>

        <Button onClick={() => setCodesAcknowledged(true)}>I have saved these</Button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Scan this with your authenticator
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Microsoft Authenticator, Google Authenticator, 1Password - any of them will do. It will
          appear as {email}.
        </p>
      </div>

      {/* Rendered server-side into a data: URI. The QR encodes the shared
          secret, so it is never fetched from an outside service. */}
      <Image
        src={enrolment.qrCodeDataUrl}
        alt="QR code for setting up two-factor authentication"
        width={240}
        height={240}
        unoptimized
        className="self-start rounded-md border border-border bg-white p-2"
      />

      {enrolment.manualKey ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Cannot scan it?
          </summary>
          <p className="mt-2 text-muted-foreground">Enter this key by hand instead:</p>
          <code className="mt-1 block break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
            {enrolment.manualKey}
          </code>
        </details>
      ) : null}

      <div className="border-t border-border pt-1">
        <p className="text-sm text-muted-foreground">
          Now enter the 6-digit code it shows, to confirm it is working.
        </p>
        <TwoFactorVerifyForm />
      </div>
    </div>
  );
}
