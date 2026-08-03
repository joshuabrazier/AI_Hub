import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session-auth-server";
import { ROUTES } from "@/lib/routes";
import { SettingsPage } from "@/features/settings/settings.page";

export default async function Settings() {
  const session = await getSession();

  if (!session) {
    redirect(ROUTES.PUBLIC_AUTH_SIGN_IN);
  }

  return <SettingsPage />;
}
