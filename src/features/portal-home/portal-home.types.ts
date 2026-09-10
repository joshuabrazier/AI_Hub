// -------------------------------------------------------------------
// Member portal home DTOs
//
// Everything here belongs to the SIGNED-IN member. There is no id anywhere in
// this shape, and no page under /portal takes one: the session is the
// identity, so there is nothing to tamper with.
// -------------------------------------------------------------------

export type PortalHomeDTO = {
  // What to greet them by, from the session. Null when their account has no
  // usable name.
  firstName: string | null;
};
