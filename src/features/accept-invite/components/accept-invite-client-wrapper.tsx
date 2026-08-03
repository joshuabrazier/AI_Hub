"use client";

import { useEffect, useState } from "react";
import { validateInviteAction } from "../accept-invite.actions";
import { AcceptInviteSignIn } from "./accept-invite-sigin-in";

export function AcceptInviteClientWrapper({ inviteToken }: { inviteToken: string }) {
  const [isValidating, setIsValidating] = useState(true);
  const [inviteData, setInviteData] = useState<{ name: string; email: string; role: string } | null>(null);

  useEffect(() => {
    async function validateInvite() {
      try {
        const response = await validateInviteAction({ inviteToken });

        if (response.success && response.data) {
          setInviteData(response.data);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsValidating(false);
      }
    }
    validateInvite();
  }, [inviteToken]);

  if (isValidating) {
    return (
      <div className="flex flex-col items-center justify-center">
        {/* Spinner */}
        <div className="h-14 w-14 animate-spin rounded-full border-6 border-primary border-t-transparent" />

        {/* Text */}
        <div className="mt-4 font-semibold text-center">Validating your invitation...</div>
      </div>
    );
  }

  if (!inviteData) {
    return (
      <div className="max-w text-center mx-auto mt-10">
        <h1 className="text-6xl font-semibold">Invalid Invitation</h1>
        <p className="mt-2 text-muted-foreground">This invitation is invalid, expired, or has already been used.</p>
      </div>
    );
  }

  return (
    <AcceptInviteSignIn
      inviteToken={inviteToken}
      name={inviteData.name}
      email={inviteData.email}
      role={inviteData.role}
    />
  );
}
