import { DisplayErrorMessage } from "@/lib/errors";

// -------------------------------------------------------------------
// Invitation errors
//
// These MUST extend DisplayErrorMessage: handleServerApiError only surfaces a
// thrown message to the user when `error instanceof DisplayErrorMessage`
// (src/lib/handle-errors.ts), and otherwise falls back to the generic
// "Something went wrong". Extending plain Error meant someone with an expired
// link was told nothing about why it failed.
//
// Both messages stay non-specific about whether the token exists, so neither
// confirms a valid invitation to someone guessing tokens.
// -------------------------------------------------------------------
export class InvalidInvitation extends DisplayErrorMessage {
  constructor(message: string = "This invitation link is not valid.") {
    super(message);
  }
}

export class ExpiredInvitation extends DisplayErrorMessage {
  constructor(message: string = "Your invitation link has expired. Please ask for a new one.") {
    super(message);
  }
}
