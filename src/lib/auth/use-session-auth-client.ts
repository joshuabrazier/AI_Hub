"use client";

import { authClient } from "@/lib/auth/auth-client";
import { USER_ROLES } from "../data/kysely-database-types";

// -----------------------------------------------------------------------------
// Session
// -----------------------------------------------------------------------------
export function useSession() {
  const { data: session, isPending, error } = authClient.useSession();

  const user = session?.user ?? null;

  return {
    session,
    user,

    isPending,
    error,

    isAuthenticated: !!session,
    isAdmin: user?.role === USER_ROLES.ADMIN,
    isManager: user?.role === USER_ROLES.MANAGER,
    isMember: user?.role === USER_ROLES.MEMBER,
    role: user?.role,
  };
}
