import { describe, expect, mock, test } from "bun:test";
import {
  attributeValue,
  durationMs,
  recordSpanError,
  recordSpanErrors,
  resolveVariables,
  startTimer,
  telemetryEnabled,
  traceCorrelationFields,
  variableAttributes,
  variableLogField,
} from "../../lib/helpers/telemetry";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";

function makeSpan(
  spanContext: { traceId: string; spanId: string; traceFlags: number } = {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    traceFlags: 1,
  },
) {
  return {
    recordException: mock(() => {}),
    setStatus: mock(() => {}),
    spanContext: () => spanContext,
  } as any;
}

// ─── attributeValue ──────────────────────────────────────────────────────────

describe("attributeValue", () => {
  test("passes primitives through untouched", () => {
    expect(attributeValue("text")).toBe("text");
    expect(attributeValue(42)).toBe(42);
    expect(attributeValue(true)).toBe(false || true);
  });

  test("renders null and undefined as null", () => {
    expect(attributeValue(null)).toBe("null");
    expect(attributeValue(undefined)).toBe("null");
  });

  test("stringifies bigints, which JSON cannot represent", () => {
    expect(attributeValue(10n)).toBe("10");
  });

  test("replaces non finite numbers, which otel rejects", () => {
    expect(attributeValue(Number.NaN)).toBe("NaN");
    expect(attributeValue(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  test("keeps homogeneous primitive arrays as arrays", () => {
    expect(attributeValue(["a", "b"])).toEqual(["a", "b"]);
    expect(attributeValue([1, 2, 3])).toEqual([1, 2, 3]);
    expect(attributeValue([true, null])).toEqual([true, null]);
  });

  test("json encodes mixed arrays, which are invalid otel attribute values", () => {
    expect(attributeValue([1, "a"])).toBe('[1,"a"]');
  });

  test("json encodes objects", () => {
    expect(attributeValue({ a: 1 })).toBe('{"a":1}');
    expect(attributeValue({ nested: { b: [1] } })).toBe('{"nested":{"b":[1]}}');
  });

  test("json encodes objects carrying bigints", () => {
    expect(attributeValue({ id: 1n })).toBe('{"id":"1"}');
  });

  test("survives circular structures", () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    expect(typeof attributeValue(circular)).toBe("string");
  });
});

// ─── variables ───────────────────────────────────────────────────────────────

describe("resolveVariables", () => {
  test("returns the variables when inclusion is undefined (the default)", () => {
    expect(resolveVariables({ id: 1 }, undefined)).toEqual({ id: 1 });
  });

  test("returns nothing when inclusion is false", () => {
    expect(resolveVariables({ id: 1 }, false)).toBeUndefined();
  });

  test("returns nothing for empty or missing variables", () => {
    expect(resolveVariables({}, true)).toBeUndefined();
    expect(resolveVariables(undefined, true)).toBeUndefined();
    expect(resolveVariables(null, true)).toBeUndefined();
  });

  test("runs a redactor and drops the result when it empties out", () => {
    expect(resolveVariables({ password: "x" }, () => ({}))).toBeUndefined();
    expect(
      resolveVariables(
        { password: "x", id: 1 },
        ({ password, ...rest }) => rest,
      ),
    ).toEqual({ id: 1 });
  });

  test("hands the redactor a copy, so the real variables stay untouched", () => {
    const variables = { id: 1 };
    resolveVariables(variables, (received) => {
      (received as any).id = 999;
      return received;
    });
    expect(variables.id).toBe(1);
  });
});

describe("variableAttributes / variableLogField", () => {
  test("spans get one flat attribute per variable", () => {
    expect(variableAttributes({ id: "42", limit: 10 }, true)).toEqual({
      "graphql.variables.id": "42",
      "graphql.variables.limit": 10,
    });
  });

  test("logs get one nested object, keeping the log line compact", () => {
    expect(variableLogField({ id: "42" }, true)).toEqual({
      "graphql.variables": { id: "42" },
    });
  });

  test("both sinks fall silent when disabled", () => {
    expect(variableAttributes({ id: "42" }, false)).toEqual({});
    expect(variableLogField({ id: "42" }, false)).toEqual({});
  });
});

// ─── correlation ─────────────────────────────────────────────────────────────

describe("traceCorrelationFields", () => {
  test("returns ids for a valid span context", () => {
    expect(
      traceCorrelationFields({ otel: { enabled: true } }, makeSpan()),
    ).toEqual({
      trace_id: TRACE_ID,
      span_id: SPAN_ID,
      trace_flags: "01",
    });
  });

  test("formats sampled and unsampled trace flags as two hex digits", () => {
    const unsampled = traceCorrelationFields(
      { otel: { enabled: true } },
      makeSpan({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 0 }),
    );
    expect(unsampled.trace_flags).toBe("00");
  });

  test("returns nothing when otel is disabled", () => {
    expect(traceCorrelationFields({}, makeSpan())).toEqual({});
    expect(
      traceCorrelationFields({ otel: { enabled: false } }, makeSpan()),
    ).toEqual({});
  });

  test("returns nothing when injectTraceId is turned off", () => {
    expect(
      traceCorrelationFields(
        {
          otel: { enabled: true },
          logger: { enabled: true, logger: {} as any, injectTraceId: false },
        },
        makeSpan(),
      ),
    ).toEqual({});
  });

  test("returns nothing for an invalid span context", () => {
    const invalid = makeSpan({
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
      traceFlags: 0,
    });
    expect(
      traceCorrelationFields({ otel: { enabled: true } }, invalid),
    ).toEqual({});
  });

  test("returns nothing when there is no span at all", () => {
    expect(traceCorrelationFields({ otel: { enabled: true } })).toEqual({});
  });
});

// ─── errors on spans ─────────────────────────────────────────────────────────

describe("recordSpanErrors", () => {
  test("records every error and flips the span to ERROR once", () => {
    const span = makeSpan();
    recordSpanErrors(span, [new Error("a"), new Error("b")]);

    expect(span.recordException).toHaveBeenCalledTimes(2);
    expect(span.setStatus).toHaveBeenCalledTimes(1);
    expect(span.setStatus.mock.calls[0][0]).toEqual({
      code: 2,
      message: "a",
    });
  });

  test("handles non Error values", () => {
    const span = makeSpan();
    recordSpanError(span, "just a string");
    expect(span.recordException).toHaveBeenCalledWith("just a string");
    expect(span.setStatus.mock.calls[0][0].message).toBe("just a string");
  });

  test("does nothing without a span or without errors", () => {
    const span = makeSpan();
    recordSpanErrors(undefined, [new Error("a")]);
    recordSpanErrors(span, []);
    expect(span.recordException).not.toHaveBeenCalled();
    expect(span.setStatus).not.toHaveBeenCalled();
  });
});

// ─── misc ────────────────────────────────────────────────────────────────────

describe("telemetryEnabled", () => {
  test("is true as soon as one sink is on", () => {
    expect(telemetryEnabled({})).toBe(false);
    expect(telemetryEnabled({ otel: { enabled: false } })).toBe(false);
    expect(telemetryEnabled({ otel: { enabled: true } })).toBe(true);
    expect(
      telemetryEnabled({ logger: { enabled: true, logger: {} as any } }),
    ).toBe(true);
  });
});

describe("durationMs", () => {
  test("measures on a monotonic clock and never goes negative", () => {
    const start = startTimer();
    const duration = durationMs(start);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(duration)).toBe(true);
  });
});
