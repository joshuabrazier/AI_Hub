import { ROUTES } from "./routes";

export class DisplayErrorMessage extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RedirectError extends Error {
  public readonly path: string;

  constructor(path: string) {
    super(`Redirect to: ${path}`);
    this.name = this.constructor.name;
    this.path = path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
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
