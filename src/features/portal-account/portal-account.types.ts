import z from "zod";

// -------------------------------------------------------------------
// Member portal account DTOs
//
// Everything here describes the SIGNED-IN member and nothing else. There is no
// user id in any shape below, and the route carries none either: the service
// resolves who is being read or written from the session, so there is nothing
// a client could point at somebody else's account.
// -------------------------------------------------------------------

// One notification category the member can opt out of. `key` is the stable
// value stored against their preferences; `name` is what they read.
export type NotificationPreferenceOptionDTO = {
  key: string;
  name: string;
  description: string | null;
};

// -------------------------------------------------------------------
// What the account page renders.
//
// `email` is shown but not editable here: changing it goes through the
// verification flow in Settings, so it is display only. The platform role is
// server-assigned and is not part of this shape at all.
// -------------------------------------------------------------------
export type PortalAccountResponseDTO = {
  name: string;
  preferredName: string;
  email: string;
  phoneNumber: string;
  // Per-type email preferences, keyed by notification type key. An absent key
  // means enabled - the model is opt-out, so a member who has never touched
  // this page still receives everything.
  notificationPreferences: Record<string, boolean>;
  // The active types to render a toggle for, in admin-configured order.
  notificationTypes: NotificationPreferenceOptionDTO[];
};

// -------------------------------------------------------------------
// Editing your own details.
//
// This schema deliberately carries no id. Adding one would reintroduce exactly
// what the portal was rebuilt to remove: a request field naming the account to
// write, which then has to be checked against the session on every path.
//
// Preferred name and phone are optional. They are personalisation, not
// identity, and forcing a value only teaches people to type rubbish into them.
// -------------------------------------------------------------------
export const UpdatePortalAccountSchema = z.object({
  name: z.string().trim().min(1, "Please enter your full name").max(255),
  preferredName: z.string().trim().max(120),
  phoneNumber: z.string().trim().max(30),
  // The submitted keys are client input, so the service re-checks them against
  // the active notification types before anything is stored.
  notificationPreferences: z.record(z.string(), z.boolean()),
});

export type UpdatePortalAccountRequestDTO = z.infer<typeof UpdatePortalAccountSchema>;
