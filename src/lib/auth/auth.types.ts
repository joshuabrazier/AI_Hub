import z from "zod";
import { USER_ROLES, UserRole } from "../data/kysely-database-types";
import { auth } from "./auth";

// -------------------------------------------------------------------
// Session Types
// -------------------------------------------------------------------
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
export type NonNullSession = NonNullable<Session>;
export type SessionUser = NonNullSession["user"] & {
  role: UserRole;
  // Read from the users row rather than the session, because a session
  // issued before setup would keep reporting "incomplete" for its whole
  // life and trap the person on the setup screen. Null until they have
  // been through it.
  profileCompletedAt: Date | null;
};

// -------------------------------------------------------------------
// Role Schemas
// -------------------------------------------------------------------
export const UserRoleSchema = z.enum(USER_ROLES);
