import AuthShell from "@/features/layout/auth-shell";
import React from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
