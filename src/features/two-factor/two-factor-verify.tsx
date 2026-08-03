"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { authClient } from "@/lib/auth/auth-client";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

// The ways a user can complete the 2FA step: their authenticator app, a code
// emailed to them, or a saved single-use backup code.
type Method = "totp" | "otp" | "backup";

function introText(method: Method, otpSent: boolean): string {
  if (method === "backup") return "Enter one of your saved backup codes.";
  if (method === "otp") {
    return otpSent ? "Enter the code we emailed you." : "Sending a code to your email address...";
  }
  return "Enter the 6-digit code from your authenticator app.";
}

function labelText(method: Method): string {
  if (method === "backup") return "Backup code";
  if (method === "otp") return "Email code";
  return "Authentication code";
}

// -------------------------------------------------------------------
// Second sign-in step: the password was accepted but 2FA is required. Finish
// with the authenticator app, an emailed one-time code, or a backup code. On
// success the full session is created; the middleware routes each role to its
// own home, so we can land everyone on the staff dashboard path.
// -------------------------------------------------------------------
export function TwoFactorVerify() {
  const [method, setMethod] = useState<Method>("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // Ask the server to email a fresh code (uses the 2FA cookie from the password
  // step to know who to send it to - we never expose the address on this page).
  const sendOtpEmail = async () => {
    if (isSending) return;
    setIsSending(true);
    try {
      const { error } = await authClient.twoFactor.sendOtp({});
      if (error) {
        toast.error("We couldn't email a code right now. Try your authenticator app instead.");
        return;
      }
      setOtpSent(true);
      toast.success("We've emailed you a code.");
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsSending(false);
    }
  };

  const switchMethod = (next: Method) => {
    setMethod(next);
    setCode("");
    // Send the first email automatically when the user picks the email method.
    if (next === "otp" && !otpSent) void sendOtpEmail();
  };

  const submit = async () => {
    const value = code.trim();
    if (isPending || value.length === 0) return;
    setIsPending(true);
    let verified = false;
    try {
      const verify = () => {
        if (method === "backup") return authClient.twoFactor.verifyBackupCode({ code: value });
        if (method === "otp") return authClient.twoFactor.verifyOtp({ code: value, trustDevice });
        return authClient.twoFactor.verifyTotp({ code: value, trustDevice });
      };
      const { error } = await verify();
      if (error) {
        if (method === "backup") toast.error("That backup code isn't valid.");
        else if (method === "otp") toast.error("That code didn't match or has expired. Try again.");
        else toast.error("That code didn't match. Try again.");
        setCode("");
        return;
      }
      // Verified. Hard-navigate (not router.push + refresh): a full request
      // re-runs the middleware with the completed session and routes each role to
      // its home. The client-side push + refresh raced that redirect and left a
      // broken "This page couldn't load" screen until a manual reload. The spinner
      // shows while the new page loads.
      verified = true;
      setRedirecting(true);
      window.location.assign(ROUTES.ADMIN_DASHBOARD);
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      // Stay in the redirecting state on success; only reset if we're staying put.
      if (!verified) setIsPending(false);
    }
  };

  const showTrust = method !== "backup";

  // After a correct code we swap the form for a spinner and hold it until the
  // destination page takes over, so the screen never looks blank mid-redirect.
  if (redirecting) {
    return (
      <div role="status" className="flex w-full flex-col items-center justify-center gap-4 py-16 text-center">
        <div
          aria-hidden
          className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"
        />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="font-heading text-3xl font-bold text-foreground">Two-factor authentication</h1>
      <p className="mt-2 text-sm text-muted-foreground">{introText(method, otpSent)}</p>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="tfa-verify-code">{labelText(method)}</Label>
          <Input
            id="tfa-verify-code"
            inputMode={method === "backup" ? "text" : "numeric"}
            autoComplete="one-time-code"
            placeholder={method === "backup" ? "xxxxxxxxxx" : "123456"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isPending}
            autoFocus
          />
        </div>

        {showTrust && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="tfa-trust"
              checked={trustDevice}
              onCheckedChange={(checked) => setTrustDevice(checked === true)}
            />
            <Label htmlFor="tfa-trust" className="font-normal">
              Trust this device for 60 days
            </Label>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isPending || code.trim().length === 0}
          loading={isPending}
        >
          {isPending ? "Verifying..." : "Verify"}
        </Button>

        <div className="flex flex-col items-start gap-2 text-sm font-medium text-primary">
          {method !== "totp" && (
            <button type="button" className="hover:underline" onClick={() => switchMethod("totp")}>
              Use your authenticator app
            </button>
          )}
          {method !== "otp" && (
            <button type="button" className="hover:underline" onClick={() => switchMethod("otp")}>
              Email me a code
            </button>
          )}
          {method === "otp" && (
            <button
              type="button"
              className="hover:underline disabled:opacity-50"
              onClick={() => void sendOtpEmail()}
              disabled={isSending}
            >
              {isSending ? "Sending..." : "Resend code"}
            </button>
          )}
          {method !== "backup" && (
            <button type="button" className="hover:underline" onClick={() => switchMethod("backup")}>
              Use a backup code
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
