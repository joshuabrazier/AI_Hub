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
};

// -------------------------------------------------------------------
// Role Schemas
// -------------------------------------------------------------------
export const UserRoleSchema = z.enum(USER_ROLES);
