import { GraphQLError } from "graphql";
/**
 * An error that gets raised by rumble whenever something does not go according to plan.
 * Mostly internals, configuration errors or other unexpected things.
 */
export class RumbleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RumbleError";
  }
}

/**
 * An error that gets raised by rumble whenever an error occurs in a resolver, containing
 * information safely exposeable to the user.
 * E.g. the assert helpers issue these.
 */
export class RumbleErrorSafe extends GraphQLError {}
