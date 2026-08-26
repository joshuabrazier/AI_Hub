import { ROUTES } from "./routes";

// -------------------------------------------------------------------
// Errors whose message is meant for the person, not the log.
//
// WHY THESE CARRY A MARKER PROPERTY, and why nothing should decide by
// `instanceof` alone. A production build splits the server into chunks, and
// a class defined in one chunk is NOT the same class object as the copy
// bundled into another. `instanceof` compares identity, so a
// DisplayErrorMessage thrown in a service and inspected in an action can be
// two different classes with the same name - the check silently returns
// false and a carefully written message collapses into "Something went
// wrong. Please try again later."
//
// That is exactly what happened to two-factor: the server produced "That
// code was not right. 4 attempts left." and the reader was shown the
// generic line instead. It would have done the same to every other message
// in the app on the wrong side of a chunk boundary.
//
// A plain boolean property survives both minification and the chunk split,
// so isDisplayError below tries identity first and falls back to it.
// -------------------------------------------------------------------
export class DisplayErrorMessage extends Error {
  /** Stable across bundle chunks, where `instanceof` is not. Never rename. */
  readonly isDisplayErrorMessage = true;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Use this rather than `instanceof DisplayErrorMessage`. See the note above. */
export function isDisplayError(error: unknown): error is DisplayErrorMessage {
  if (error instanceof DisplayErrorMessage) return true;

  return (
    typeof error === "object" &&
    error !== null &&
    (error as { isDisplayErrorMessage?: unknown }).isDisplayErrorMessage === true
  );
}

export class RedirectError extends Error {
  /** Stable across bundle chunks, where `instanceof` is not. Never rename. */
  readonly isRedirectError = true;

  public readonly path: string;

  constructor(path: string) {
    super(`Redirect to: ${path}`);
    this.name = this.constructor.name;
    this.path = path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Use this rather than `instanceof RedirectError`. See the note above. */
export function isRedirectError(error: unknown): error is RedirectError {
  if (error instanceof RedirectError) return true;

  return (
    typeof error === "object" &&
    error !== null &&
    (error as { isRedirectError?: unknown }).isRedirectError === true
  );
}

export class InvitationCompletedRedirectError extends RedirectError {
  constructor(path = ROUTES.PUBLIC_AUTH_SIGN_IN_INVITE_ALREADY_COMPLETE) {
    super(path);
  }
}

export class UserWithEmailAlreadyExistsDisplayError extends DisplayErrorMessage {
  constructor(message = "User with email already exists") {
    super(message);
  }
}

export class ClientWithEmailAlreadyExistsDisplayError extends DisplayErrorMessage {
  constructor(message = "Client with email already exists") {
    super(message);
  }
}
