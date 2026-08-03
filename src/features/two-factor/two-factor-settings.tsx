"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth/auth-client";
import { useSession } from "@/lib/auth/use-session-auth-client";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { TwoFactorSetup } from "./two-factor-setup";

// -------------------------------------------------------------------
// Settings section: turn two-factor on (via the setup wizard) or off.
// -------------------------------------------------------------------
export function TwoFactorSettings() {
  const { user, isPending: sessionPending, isAdmin, isManager } = useSession();
  const sessionEnabled = Boolean((user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled);
  // Reflect the session, but let an enable/disable this session win immediately
  // (better-auth's session store may not refetch on its own).
  const [override, setOverride] = useState<boolean | null>(null);
  const enabled = override ?? sessionEnabled;
  // Staff have 2FA enforced by the middleware, so they are not offered the
  // option to turn it off - it would only bounce them back to setup.
  const isStaff = isAdmin || isManager;
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);

  const disable = async () => {
    if (isPending || password.length === 0) return;
    setIsPending(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        toast.error(error.message ?? "Couldn't turn off two-factor. Check your password.");
        return;
      }
      toast.success("Two-factor authentication is off.");
      setOverride(false);
      setConfirmingDisable(false);
      setPassword("");
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          <div className="space-y-0.5">
            <CardTitle className="font-heading text-xl">Two-factor authentication</CardTitle>
            <CardDescription>Add a second step at sign-in with an authenticator app.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionPending && override === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : enabled ? (
          <>
            <div className="space-y-2">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  On
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                You&apos;ll be asked for a code when you sign in. Use your authenticator app, or have a code emailed to you.
              </p>
            </div>
            {isStaff ? (
              <p className="text-sm text-muted-foreground">
                Two-factor is required for staff accounts, so it can&apos;t be turned off.
              </p>
            ) : confirmingDisable ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  disable();
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="tfa-disable-password">Confirm your password to turn it off</Label>
                  <Input
                    id="tfa-disable-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isPending}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setConfirmingDisable(false);
                      setPassword("");
                    }}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" disabled={isPending || password.length === 0} loading={isPending}>
                    Turn off two-factor
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="outline" onClick={() => setConfirmingDisable(true)}>
                Turn off
              </Button>
            )}
          </>
        ) : setupOpen ? (
          <TwoFactorSetup
            onEnabled={() => {
              setOverride(true);
              setSetupOpen(false);
            }}
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Not set up yet.</p>
            <Button onClick={() => setSetupOpen(true)}>Set up two-factor</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
