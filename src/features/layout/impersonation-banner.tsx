"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { authClient } from "@/lib/auth/auth-client";
import { ROUTES } from "@/lib/routes";
import { Button } from "@/components/ui/button";

// Shown at the top of the client portal whenever an admin is viewing it "as" a
// client (impersonation). Gives an unmistakable indicator + a one-click way back
// to the admin's own account.
export function ImpersonationBanner({ viewingAsName }: { viewingAsName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleReturn() {
    setLoading(true);
    const { error } = await authClient.admin.stopImpersonating();

    if (error) {
      // Session may have already expired - send them to sign in as a fallback.
      setLoading(false);
      router.push(ROUTES.PUBLIC_AUTH_SIGN_IN);
      return;
    }

    router.push(ROUTES.ADMIN_USERS);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b border-data-caution/40 bg-data-caution-surface px-4 py-2 text-sm text-data-caution-text">
      <ShieldAlert size={16} aria-hidden="true" className="shrink-0" />
      <span className="text-center">
        You&apos;re viewing the portal as <strong className="font-semibold">{viewingAsName}</strong>. Changes are saved
        as this client.
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={handleReturn}
        disabled={loading}
        className="border-data-caution/40 bg-data-caution-surface text-data-caution-text hover:bg-data-caution/15"
      >
        {loading ? "Returning…" : "Return to admin"}
      </Button>
    </div>
  );
}
