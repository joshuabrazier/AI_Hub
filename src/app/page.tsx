import { redirect } from "next/navigation";

import LandingPage from "@/features/landing/landing-page";
import { getSession } from "@/lib/auth/session-auth-server";
import { roleHome } from "@/lib/routes";

export default async function Home() {
  const session = await getSession();

  // A signed-in visitor skips the landing page and goes straight to their
  // area. There is no 2FA staging step to route around any more: sign-in is
  // Microsoft only, so Entra has already applied whatever Conditional Access
  // requires before the session exists.
  //
  // Somebody who has not finished first-run setup is sent to /welcome by the
  // guard inside whichever area they land in, rather than being special-cased
  // here - one place decides that, and it is requireUser.
  if (session) {
    redirect(roleHome(session.user.role));
  }

  return <LandingPage />;
}
