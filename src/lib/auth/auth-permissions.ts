import { createAccessControl } from "better-auth/plugins/access";

// -------------------------------------------------------------------
// Restricted Better Auth Admin Plugin permissions to impersonate only
// -------------------------------------------------------------------
export const statement = {
  user: ["impersonate"],
} as const;

export const accessControl = createAccessControl(statement);

export const impersonatorOnly = accessControl.newRole({
  user: ["impersonate"],
});
