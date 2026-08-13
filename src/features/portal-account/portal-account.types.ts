import z from "zod";

// -------------------------------------------------------------------
// Member portal account DTOs
//
// Everything here describes the SIGNED-IN member and nothing else. There is no
// user id in any shape below, and the route carries none either: the service
// resolves who is being read or written from the session, so there is nothing
// a client could point at somebody else's account.
// -------------------------------------------------------------------

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
});

export type UpdatePortalAccountRequestDTO = z.infer<typeof UpdatePortalAccountSchema>;
