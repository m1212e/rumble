import type { GraphQLError } from "graphql";

/**
 * Shape of a single error entry in a log's `errors` array, following
 * OpenTelemetry's exception semantic conventions
 * (https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/).
 */
export interface LoggedException {
  "exception.type": string;
  "exception.message": string;
  "exception.stacktrace"?: string;
  path?: ReadonlyArray<string | number>;
  extensions?: Record<string, unknown>;
}

function hasMessage(error: unknown): error is { message: unknown } {
  return typeof error === "object" && error !== null && "message" in error;
}

function toLoggedException(error: unknown): LoggedException {
  if (hasMessage(error)) {
    const gqlError = error as Partial<GraphQLError> & Error;
    return {
      "exception.type": gqlError.constructor?.name ?? gqlError.name ?? "Error",
      "exception.message": String(gqlError.message),
      ...(gqlError.stack ? { "exception.stacktrace": gqlError.stack } : {}),
      ...(gqlError.path ? { path: gqlError.path } : {}),
      ...(gqlError.extensions && Object.keys(gqlError.extensions).length > 0
        ? { extensions: gqlError.extensions }
        : {}),
    };
  }
  return {
    "exception.type": "UnknownError",
    "exception.message": String(error),
  };
}

/**
 * Every erroneous rumble log carries the same `errors` array shape,
 * whether it originates from a thrown exception (single-element array)
 * or a GraphQL `ExecutionResult.errors` list (multi-element array).
 */
export function errorsLogField(errors: readonly unknown[]): {
  errors: LoggedException[];
} {
  return { errors: errors.map(toLoggedException) };
}

export function errorLogField(error: unknown): { errors: LoggedException[] } {
  return errorsLogField([error]);
}
