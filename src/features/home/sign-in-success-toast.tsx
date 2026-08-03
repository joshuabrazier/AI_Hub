"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

// -------------------------------------------------------------------
// Shows a one-off "signed in" toast when redirected with
// ?sign-in-success=true, then cleans the query param from the URL.
// -------------------------------------------------------------------
export function SignInSuccessToast() {
  const searchParams = useSearchParams();
  const isSignInSuccess = searchParams.get("sign-in-success");

  useEffect(() => {
    if (isSignInSuccess !== "true") return;

    const timeout = setTimeout(() => toast.success("User signed in successfully"), 100);
    window.history.replaceState({}, document.title, window.location.pathname);

    return () => clearTimeout(timeout);
  }, [isSignInSuccess]);

  return null;
}
