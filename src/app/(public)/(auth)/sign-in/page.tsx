import { SignInPage } from "@/features/sign-in/sigin-in.page";
import { isMicrosoftSignInConfigured } from "@/lib/auth/account-creation-policy";

// -------------------------------------------------------------------
// /sign-in
//
// `error` is set by Better Auth when it bounces somebody back here - the
// account-creation gate refusing an address outside the allowed domains, or
// a guest account. The page says something useful rather than showing a bare
// button again, but deliberately does not repeat the reason: which of the
// two it was is in the server log, not in the browser.
// -------------------------------------------------------------------
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <SignInPage
      microsoftEnabled={isMicrosoftSignInConfigured()}
      refused={typeof params.error === "string" && params.error.length > 0}
    />
  );
}
