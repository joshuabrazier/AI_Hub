import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// Forbidden page
// Rendered at ROUTES.ERROR_FORBIDDEN, which is where requireSession,
// requireUser and requireUserRole all redirect when a check fails
// (src/lib/auth/session-auth-server.ts). It is reached by people who are
// signed in but lack the role for the area they asked for, so it says that
// plainly rather than implying the page is missing.
//
// Sizing matches the app shell: the shell already offsets for the fixed
// navbar, so this fills the remaining viewport rather than a whole screen.
// -------------------------------------------------------------------
export default function ForbiddenPage() {
  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="size-7" aria-hidden="true" />
      </span>

      <h1 className="font-heading text-3xl font-bold text-foreground">Access denied</h1>

      <p className="max-w-md text-muted-foreground">
        Your account does not have permission to view this page. If you think it should, ask an administrator to check
        your access.
      </p>

      <Button asChild className="mt-2">
        <Link href={ROUTES.PUBLIC_HOME}>Go to home</Link>
      </Button>
    </div>
  );
}
