import { SignInPage } from "@/features/sign-in/sigin-in.page";
import { isMicrosoftSignInConfigured } from "@/lib/auth/account-creation-policy";
import { redirectIfAuthenticated } from "@/lib/auth/session-auth-server";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Already signed in? Don't show the login form - go to their portal.
  await redirectIfAuthenticated();

  const params = await searchParams;

  return (
    <SignInPage
      emailChanged={params["email-changed"] === "true"}
      microsoftEnabled={isMicrosoftSignInConfigured()}
    />
  );
}
