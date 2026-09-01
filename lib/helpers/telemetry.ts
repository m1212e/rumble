import {
  type Attributes,
  type AttributeValue,
  isSpanContextValid,
  type Span,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import {
  ATTR_GRAPHQL_DOCUMENT,
  ATTR_GRAPHQL_OPERATION_NAME,
  ATTR_GRAPHQL_OPERATION_TYPE,
} from "@opentelemetry/semantic-conventions/incubating";
import { AttributeNames, SpanNames } from "@pothos/tracing-opentelemetry";
import type { RumbleInput, RumbleLogger } from "../types/rumbleInput";

/**
 * Which entry point served the current GraphQL operation.
 *
 * Every operation span and log entry carries this as `rumble.transport` so the
 * GraphQL endpoint, the SOFA REST adapter and the WebSocket handler emit the
 * exact same telemetry shape and stay comparable in a single query.
 */
export type RumbleTransport = "graphql" | "rest" | "ws";

/**
 * The slice of the rumble input that drives telemetry. Kept structural so every
 * helper in the library can take it without repeating rumble's generic signature.
 */
export type TelemetryConfig = Pick<
  RumbleInput<any, any, any, any, any>,
  "otel" | "logger"
>;

// ─── span names ──────────────────────────────────────────────────────────────
// The GraphQL ones align with @pothos/tracing-opentelemetry so rumble's spans sit
// in the same namespace as the resolver spans pothos emits.

export const SPAN_EXECUTE: string = SpanNames.EXECUTE;
/** @pothos/tracing-opentelemetry's SpanNames enum has no subscribe member. */
export const SPAN_SUBSCRIBE = "graphql.subscribe";
export const SPAN_SUBSCRIBE_EVENT = "graphql.subscribe.event";
export const SPAN_ABILITIES_PREPARE = "rumble.abilities.prepare";
export const SPAN_FILTERS_APPLY = "rumble.filters.apply";
export const SPAN_FILTERS_RESOLVE = "rumble.filters.resolve";

// ─── attribute and log field names ───────────────────────────────────────────
// Span attributes and log fields deliberately share names, so the same key means
// the same thing whether you are looking at a trace or at a log line. The GraphQL
// ones come from OpenTelemetry's (still incubating) GraphQL semantic conventions
// and happen to be exactly what pothos uses, so resolver and operation spans line
// up without any translation.

export const ATTR_OPERATION_NAME: string = ATTR_GRAPHQL_OPERATION_NAME;
export const ATTR_OPERATION_TYPE: string = ATTR_GRAPHQL_OPERATION_TYPE;
export const ATTR_DOCUMENT: string = ATTR_GRAPHQL_DOCUMENT;
export const ATTR_FIELD_NAME: string = AttributeNames.FIELD_NAME;
/** Prefix for per-variable span attributes, e.g. `graphql.variables.userId`. */
export const ATTR_VARIABLES_PREFIX: string = AttributeNames.VARIABLES;
/** Log field holding all variables as one object (logs keep nesting, spans flatten). */
export const FIELD_VARIABLES = "graphql.variables";
export const ATTR_PARENT_TYPE = "graphql.parent.type";
export const ATTR_TRANSPORT = "rumble.transport";
export const ATTR_TABLE = "rumble.table";
export const ATTR_ACTION = "rumble.action";
export const ATTR_ABILITIES_STATUS = "rumble.abilities.status";
export const ATTR_ABILITIES_STATIC = "rumble.abilities.static";
export const ATTR_ABILITIES_DYNAMIC = "rumble.abilities.dynamic";
export const ATTR_ABILITIES_TOTAL = "rumble.abilities.total";
export const ATTR_FILTERS_TOTAL = "rumble.filters.total";
export const ATTR_FILTERS_ALLOWED = "rumble.filters.allowed";
export const ATTR_SUBSCRIPTION_EVENT_INDEX = "rumble.subscription.event_index";
export const FIELD_DURATION_MS = "duration_ms";
export const FIELD_EVENT_COUNT = "event_count";

// ─── config accessors ────────────────────────────────────────────────────────

export function telemetryLogger(
  config: TelemetryConfig,
): RumbleLogger | undefined {
  return config.logger?.enabled ? config.logger.logger : undefined;
}

export function telemetryTracer(config: TelemetryConfig): Tracer | undefined {
  return config.otel?.enabled ? config.otel.tracer : undefined;
}

/**
 * Whether anything at all should be instrumented. When this is false, rumble
 * hands the untouched execute/subscribe functions back to the transports so a
 * user who wants neither traces nor logs pays no overhead.
 */
export function telemetryEnabled(config: TelemetryConfig): boolean {
  return Boolean(config.otel?.enabled || config.logger?.enabled);
}

// ─── log/trace correlation ───────────────────────────────────────────────────

/**
 * `trace_id`/`span_id`/`trace_flags` for the given span, or for the currently
 * active one when no span is passed. Field names and the two-hex-digit flags
 * format follow the OpenTelemetry log data model, which is what log backends
 * (Loki, Tempo, Elastic) expect when linking a log line to its trace.
 *
 * Reading the *active* span means every rumble log site gets correlation for
 * free, without threading a child logger through the whole library.
 */
export function traceCorrelationFields(
  config: TelemetryConfig,
  span?: Span,
): Record<string, string> {
  if (!config.otel?.enabled || config.logger?.injectTraceId === false) {
    return {};
  }

  const target = span ?? trace.getActiveSpan();
  if (!target) return {};

  const spanContext = target.spanContext();
  if (!isSpanContextValid(spanContext)) return {};

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags.toString(16).padStart(2, "0"),
  };
}

// ─── errors on spans ─────────────────────────────────────────────────────────

function toException(error: unknown) {
  if (error instanceof Error) return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return error as { message: string };
  }
  return String(error);
}

function exceptionMessage(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return error === undefined ? undefined : String(error);
}

/**
 * Records every error as an exception event and flips the span to ERROR, per
 * OpenTelemetry's exception conventions. Used for rumble's own spans as well as
 * the GraphQL operation spans so a failure looks identical wherever it happens.
 */
export function recordSpanErrors(
  span: Span | undefined,
  errors: readonly unknown[],
): void {
  if (!span || errors.length === 0) return;

  for (const error of errors) {
    span.recordException(toException(error));
  }

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: exceptionMessage(errors[0]),
  });
}

export function recordSpanError(span: Span | undefined, error: unknown): void {
  recordSpanErrors(span, [error]);
}

// ─── attribute values ────────────────────────────────────────────────────────

function safeJsonStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, inner) =>
        typeof inner === "bigint" ? inner.toString() : inner,
      ) ?? "null"
    );
  } catch {
    // circular structures, throwing getters, exotic objects
    return String(value);
  }
}

function isHomogeneousPrimitiveArray(value: unknown[]): boolean {
  let seen: "string" | "number" | "boolean" | undefined;
  for (const entry of value) {
    if (entry === null || entry === undefined) continue;
    const type = typeof entry;
    if (type !== "string" && type !== "number" && type !== "boolean") {
      return false;
    }
    if (seen && seen !== type) return false;
    seen = type;
  }
  return true;
}

/**
 * Coerces an arbitrary value into something the OpenTelemetry attribute type
 * allows: primitives pass through, homogeneous primitive arrays stay arrays
 * (mixed ones are invalid per spec) and everything else becomes JSON.
 *
 * Values are intentionally not truncated here — length limits belong to the SDK
 * (`OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT`) so they stay configurable per deployment.
 */
export function attributeValue(value: unknown): AttributeValue {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
      return "null";
    default:
      break;
  }

  if (value === null) return "null";
  if (Array.isArray(value) && isHomogeneousPrimitiveArray(value)) {
    return value as AttributeValue;
  }
  return safeJsonStringify(value);
}

// ─── GraphQL variables ───────────────────────────────────────────────────────

/**
 * `true` (default) captures all variables, `false` captures none, and a function
 * lets you redact or drop individual entries before they reach a span or a log.
 */
export type VariableInclusion =
  | boolean
  | ((
      variables: Record<string, unknown>,
    ) => Record<string, unknown> | undefined)
  | undefined;

export function resolveVariables(
  variables: Readonly<Record<string, unknown>> | null | undefined,
  include: VariableInclusion,
): Record<string, unknown> | undefined {
  if (include === false || !variables) return undefined;

  const resolved =
    typeof include === "function" ? include({ ...variables }) : variables;

  if (!resolved || Object.keys(resolved).length === 0) return undefined;
  return resolved as Record<string, unknown>;
}

/** Variables flattened into `graphql.variables.<name>` span attributes. */
export function variableAttributes(
  variables: Readonly<Record<string, unknown>> | null | undefined,
  include: VariableInclusion,
): Attributes {
  const resolved = resolveVariables(variables, include);
  if (!resolved) return {};

  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(resolved)) {
    attributes[`${ATTR_VARIABLES_PREFIX}${key}`] = attributeValue(value);
  }
  return attributes;
}

/** Variables as a single nested `graphql.variables` log field. */
export function variableLogField(
  variables: Readonly<Record<string, unknown>> | null | undefined,
  include: VariableInclusion,
): Record<string, unknown> {
  const resolved = resolveVariables(variables, include);
  return resolved ? { [FIELD_VARIABLES]: resolved } : {};
}

// ─── durations ───────────────────────────────────────────────────────────────

/**
 * Monotonic clock reading. `Date.now()` can jump backwards when the wall clock is
 * adjusted (NTP), which would produce negative or inflated durations.
 */
export function startTimer(): number {
  return performance.now();
}

export function durationMs(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}
