"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { verifyTwoFactorAction } from "../two-factor.actions";

// -------------------------------------------------------------------
// The code field, shared by both screens.
//
// One field with a toggle rather than two forms: a backup code is used at
// exactly the moment somebody is already flustered about a lost phone, and
// making them find a different screen for it is the wrong time to add a
// step.
//
// On success it navigates to "/" and refreshes rather than pushing a
// specific area. Where somebody belongs is decided by their role, and that
// decision already exists in one place server-side - repeating it here
// would be a second copy that could disagree.
// -------------------------------------------------------------------
export function TwoFactorVerifyForm({ autoFocus = true }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending || !code.trim()) return;

    setIsPending(true);

    try {
      const response = await verifyTwoFactorAction({ code, useBackupCode });

      if (!response.success) {
        // The server decides what to say here - how many attempts are left,
        // or that the session is locked. Passing it through unchanged keeps
        // one source of truth for the count.
        toast.error(response.formError ?? "That code was not right");
        setCode("");
        return;
      }

      // The destination comes from the server, which is the only side that
      // knows the role. Refresh first so the layouts re-render with a
      // session that has now passed the gate - otherwise the push can land
      // on a cached tree that still thinks it has to send us back here.
      router.refresh();
      router.replace(response.data.redirectTo);
    } catch (error) {
      // The shared handler, not a local message - it is the only thing that
      // recognises a stale deployment, which is by far the most likely
      // reason a call from this form fails outright rather than returning.
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="two-factor-code">
          {useBackupCode ? "Backup code" : "6-digit code"}
        </Label>
        <Input
          id="two-factor-code"
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoFocus={autoFocus}
          autoComplete="one-time-code"
          // A numeric keypad on a phone for TOTP, but a full keyboard for a
          // backup code, which is not digits.
          inputMode={useBackupCode ? "text" : "numeric"}
          placeholder={useBackupCode ? "Enter a backup code" : "000000"}
          disabled={isPending}
          className={useBackupCode ? undefined : "font-mono tracking-[0.4em]"}
        />
      </div>

      <Button type="submit" disabled={isPending || !code.trim()}>
        {isPending ? "Checking..." : "Verify"}
      </Button>

      <button
        type="button"
        className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={() => {
          setUseBackupCode((previous) => !previous);
          setCode("");
        }}
        disabled={isPending}
      >
        {useBackupCode ? "Use my authenticator app instead" : "I do not have my phone - use a backup code"}
      </button>
    </form>
  );
}
