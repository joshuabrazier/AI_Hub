import Link from "next/link";

import PortalPage from "@/features/layout/portal-page";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

import { PortalAccountForm } from "./components/portal-account-form";
import { getPortalAccountService } from "./portal-account.service";

// The initials shown in the avatar: first letter of the first and last words
// of their name. One word gives one letter rather than the same letter twice.
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0);

  if (!first) return "?";

  const last = parts.at(-1) ?? first;

  return (first.charAt(0) + (parts.length === 1 ? "" : last.charAt(0))).toUpperCase();
}

// -------------------------------------------------------------------
// Member portal account page
//
// The account shown is the signed-in member's, resolved from the session
// inside the service. The route carries no id, so there is nothing here that
// could be pointed at somebody else.
// -------------------------------------------------------------------
export default async function PortalAccountPage() {
  const account = await getPortalAccountService();

  // What they asked to be called, falling back to their name.
  const displayName = account.preferredName || account.name;

  return (
    <PortalPage
      eyebrow="Your portal"
      title="Account"
      description="Your details and what we email you about. Change your email or password from Settings."
      size="narrow"
    >
      <div className="space-y-6">
        {/* Identity summary. Read-only: it reflects the form below rather than
            offering a second place to edit the same fields. */}
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-primary/5 p-6">
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-xl font-bold text-primary-foreground"
          >
            {getInitials(account.name)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-2xl font-bold text-foreground">{displayName}</p>
            <p className="truncate text-muted-foreground">{account.email}</p>
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link href={ROUTES.SETTINGS}>Security settings</Link>
          </Button>
        </div>

        <PortalAccountForm account={account} />
      </div>
    </PortalPage>
  );
}
