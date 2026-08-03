"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/auth-client";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

// Pull the base32 secret out of an otpauth:// URI, for manual entry when a
// QR can't be scanned.
function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------
// Two-factor setup wizard (TOTP authenticator app).
//   1. Confirm password  -> stages a secret (2FA not yet active).
//   2. Scan the QR (or enter the key), save backup codes, enter a code
//      to verify -> 2FA turns on. A bad scan can never lock you out
//      because it only activates after a correct code.
// Reused by Settings and the mandatory staff setup page.
// -------------------------------------------------------------------
export function TwoFactorSetup({ onEnabled }: { onEnabled?: () => void }) {
  const [step, setStep] = useState<"password" | "verify">("password");
  const [password, setPassword] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [isPending, setIsPending] = useState(false);

  const startEnable = async () => {
    if (isPending || password.length === 0) return;
    setIsPending(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data) {
        toast.error(error?.message ?? "Couldn't start setup. Check your password and try again.");
        return;
      }
      setQrDataUrl(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }));
      setManualKey(secretFromUri(data.totpURI));
      setBackupCodes(data.backupCodes);
      setStep("verify");
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
    }
  };

  const verify = async () => {
    if (isPending || code.trim().length === 0) return;
    setIsPending(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (error) {
        toast.error("That code didn't match. Check your authenticator app and try again.");
        return;
      }
      toast.success("Two-factor authentication is on.");
      onEnabled?.();
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
    }
  };

  if (step === "password") {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          startEnable();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Confirm your password to start setting up an authenticator app (e.g. Google or Microsoft Authenticator).
        </p>
        <div className="grid gap-2">
          <Label htmlFor="tfa-password">Current password</Label>
          <Input
            id="tfa-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isPending}
          />
        </div>
        <Button type="submit" disabled={isPending || password.length === 0} loading={isPending}>
          {isPending ? "Starting..." : "Start setup"}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        verify();
      }}
    >
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">1. Scan this QR code in your authenticator app</p>
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data-URI QR, not a hosted asset
          <img src={qrDataUrl} alt="Two-factor QR code" className="max-w-full rounded-md border bg-white p-2" width={200} height={200} />
        )}
        {manualKey && (
          <p className="text-xs text-muted-foreground">
            Can&apos;t scan? Enter this key manually:{" "}
            <span className="font-mono text-foreground break-all">{manualKey}</span>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          2. Save your backup {backupCodes.length === 1 ? "code" : "codes"}
        </p>
        <p className="text-xs text-muted-foreground">
          Store {backupCodes.length === 1 ? "it" : "these"} somewhere safe.{" "}
          {backupCodes.length === 1 ? "It" : "Each one"} can be used once to sign in if you lose your authenticator.
        </p>
        <div className="grid grid-cols-1 gap-1 rounded-md border bg-muted p-3 font-mono text-sm break-all sm:grid-cols-2">
          {backupCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tfa-code">3. Enter the 6-digit code to finish</Label>
        <Input
          id="tfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={isPending}
        />
      </div>

      <Button type="submit" disabled={isPending || code.trim().length === 0} loading={isPending}>
        {isPending ? "Verifying..." : "Turn on two-factor"}
      </Button>
    </form>
  );
}
