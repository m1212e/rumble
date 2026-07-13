import { describe, expect, mock, test } from "bun:test";
import { buildSchema, parse } from "graphql";
import {
  buildTracedExecute,
  buildTracedSubscribe,
  isAsyncIterable,
  wrapSubscriptionIterator,
} from "../../lib/helpers/tracing";

// ─── shared test fixtures ───────────────────────────────────────────────────

const schema = buildSchema("type Query { test: String }");
const document = parse("query TestOp { __typename }");
const baseArgs = { schema, document, operationName: "TestOp" };

function makeMockLogger() {
  const logger: any = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  };
  logger.child = mock(() => logger);
  return logger;
}

function makeMockSpan() {
  return {
    recordException: mock(() => {}),
    setStatus: mock(() => {}),
    end: mock(() => {}),
    spanContext: () => ({ traceId: "trace-abc", spanId: "span-xyz" }),
  };
}

function makeMockTracer(span: ReturnType<typeof makeMockSpan>) {
  return {
    startActiveSpan: mock((name: string, optionsOrCb: any, cb?: any) => {
      const callback = cb ?? optionsOrCb;
      return callback(span);
    }),
  };
}

function makeRumbleInput(opts: {
  logger?: { enabled?: boolean; logger?: any; injectTraceId?: boolean };
  otel?: { enabled?: boolean; tracer?: any };
}) {
  return opts as any;
}

// ─── isAsyncIterable ─────────────────────────────────────────────────────────

describe("isAsyncIterable", () => {
  test("returns true for an async generator", () => {
    const gen = (async function* () {
      yield 1;
    })();
    expect(isAsyncIterable(gen)).toBe(true);
  });

  test("returns true for an object with Symbol.asyncIterator", () => {
    const obj = { [Symbol.asyncIterator]: () => {} };
    expect(isAsyncIterable(obj)).toBe(true);
  });

  test("returns false for a plain object", () => {
    expect(isAsyncIterable({})).toBe(false);
  });

  test("returns false for an array (sync iterable, not async)", () => {
    expect(isAsyncIterable([1, 2, 3])).toBe(false);
  });

  test("returns false for null, undefined, and primitives", () => {
    expect(isAsyncIterable(null)).toBe(false);
    expect(isAsyncIterable(undefined)).toBe(false);
    expect(isAsyncIterable("string")).toBe(false);
    expect(isAsyncIterable(42)).toBe(false);
  });
});

// ─── wrapSubscriptionIterator ────────────────────────────────────────────────

describe("wrapSubscriptionIterator", () => {
  test("passes all events through unchanged", async () => {
    const source = (async function* () {
      yield { data: { a: 1 } };
      yield { data: { a: 2 } };
    })();

    const log = makeMockLogger();
    const events = [];
    for await (const event of wrapSubscriptionIterator(source, log, "Op")) {
      events.push(event);
    }

    expect(events).toEqual([{ data: { a: 1 } }, { data: { a: 2 } }]);
  });

  test("logs error for events that carry GraphQL errors", async () => {
    const source = (async function* () {
      yield { errors: [{ message: "boom" }] };
    })();

    const log = makeMockLogger();
    for await (const _ of wrapSubscriptionIterator(source, log, "Op")) {
    }

    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.error as any).mock.calls[0];
    expect(fields["graphql.operation.name"]).toBe("Op");
    expect(fields.errors).toContain("boom");
    expect(msg).toContain("error");
  });

  test("does not log individual successful events", async () => {
    const source = (async function* () {
      yield { data: {} };
      yield { data: {} };
    })();

    const log = makeMockLogger();
    for await (const _ of wrapSubscriptionIterator(source, log, "Op")) {
    }

    expect(log.info).toHaveBeenCalledTimes(1); // only the completion log
  });

  test("logs completion with eventCount", async () => {
    const source = (async function* () {
      yield { data: {} };
      yield { data: {} };
      yield { data: {} };
    })();

    const log = makeMockLogger();
    for await (const _ of wrapSubscriptionIterator(source, log, "MyOp")) {
    }

    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.info as any).mock.calls[0];
    expect(fields["graphql.operation.name"]).toBe("MyOp");
    expect(fields.eventCount).toBe(3);
    expect(msg).toContain("completed");
  });

  test("logs and rethrows when the iterator throws", async () => {
    const source = (async function* () {
      yield { data: {} };
      throw new Error("iterator error");
    })();

    const log = makeMockLogger();
    await expect(async () => {
      for await (const _ of wrapSubscriptionIterator(source, log, "Op")) {
      }
    }).toThrow("iterator error");

    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.error as any).mock.calls[0];
    expect(fields.err).toBeInstanceOf(Error);
    expect(msg).toContain("threw");
  });
});

// ─── buildTracedExecute ───────────────────────────────────────────────────────

describe("buildTracedExecute — logger only", () => {
  test("logs start and completion, returns result", async () => {
    const log = makeMockLogger();
    const executeFn = mock(async () => ({ data: { test: "ok" } }));

    const wrapped = buildTracedExecute(
      executeFn,
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    const result = await wrapped(baseArgs);

    expect(result).toEqual({ data: { test: "ok" } });
    expect(executeFn).toHaveBeenCalledWith(baseArgs);
    expect(log.info).toHaveBeenCalledTimes(2);
    expect((log.info as any).mock.calls[0][1]).toContain("start");
    expect((log.info as any).mock.calls[1][1]).toContain("completed");
    expect(
      (log.info as any).mock.calls[1][0].durationMs,
    ).toBeGreaterThanOrEqual(0);
  });

  test("logs error when result contains GraphQL errors", async () => {
    const log = makeMockLogger();
    const executeFn = mock(async () => ({
      errors: [{ message: "field error" }],
    }));

    const wrapped = buildTracedExecute(
      executeFn,
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    await wrapped(baseArgs);

    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.error as any).mock.calls[0];
    expect(fields.errors).toContain("field error");
    expect(msg).toContain("errors");
  });

  test("logs and rethrows on thrown exception", async () => {
    const log = makeMockLogger();
    const executeFn = mock(async () => {
      throw new Error("execute failed");
    });

    const wrapped = buildTracedExecute(
      executeFn,
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    await expect(wrapped(baseArgs)).rejects.toThrow("execute failed");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect((log.error as any).mock.calls[0][1]).toContain("threw");
  });

  test("uses operationName from args in log fields", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    await wrapped({ ...baseArgs, operationName: "MyQuery" });

    for (const [fields] of (log.info as any).mock.calls) {
      expect(fields["graphql.operation.name"]).toBe("MyQuery");
    }
  });

  test("falls back to 'anonymous' when operationName is undefined", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    await wrapped({ ...baseArgs, operationName: undefined });

    expect((log.info as any).mock.calls[0][0]["graphql.operation.name"]).toBe(
      "anonymous",
    );
  });
});

describe("buildTracedExecute — otel only", () => {
  test("creates a span with the correct name and ends it on success", async () => {
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
    );

    await wrapped(baseArgs);

    expect(tracer.startActiveSpan).toHaveBeenCalledTimes(1);
    expect((tracer.startActiveSpan as any).mock.calls[0][0]).toBe(
      "graphql.execute",
    );
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.setStatus).not.toHaveBeenCalled();
  });

  test("records exception and sets error status on result errors", async () => {
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const err = { message: "oops" };
    const wrapped = buildTracedExecute(
      mock(async () => ({ errors: [err] })),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
    );

    await wrapped(baseArgs);

    expect(span.recordException).toHaveBeenCalledTimes(1);
    expect(span.setStatus).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  test("records exception, sets error status and rethrows on thrown exception", async () => {
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const wrapped = buildTracedExecute(
      mock(async () => {
        throw new Error("otel fail");
      }),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
    );

    await expect(wrapped(baseArgs)).rejects.toThrow("otel fail");
    expect(span.recordException).toHaveBeenCalledTimes(1);
    expect(span.setStatus).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});

describe("buildTracedExecute — logger + otel", () => {
  test("injects traceId and spanId into child logger by default", async () => {
    const log = makeMockLogger();
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        logger: { enabled: true, logger: log },
        otel: { enabled: true, tracer },
      }),
    );

    await wrapped(baseArgs);

    expect(log.child).toHaveBeenCalledTimes(1);
    const childArgs = (log.child as any).mock.calls[0][0];
    expect(childArgs.traceId).toBe("trace-abc");
    expect(childArgs.spanId).toBe("span-xyz");
  });

  test("skips traceId injection when injectTraceId is false", async () => {
    const log = makeMockLogger();
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        logger: { enabled: true, logger: log, injectTraceId: false },
        otel: { enabled: true, tracer },
      }),
    );

    await wrapped(baseArgs);

    expect(log.child).not.toHaveBeenCalled();
  });
});

// ─── buildTracedSubscribe ─────────────────────────────────────────────────────

describe("buildTracedSubscribe — logger only", () => {
  test("logs subscribe start and established, returns wrapped iterator", async () => {
    const log = makeMockLogger();
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    const result = await wrapped(baseArgs);

    expect(isAsyncIterable(result)).toBe(true);
    expect(log.info).toHaveBeenCalledTimes(2);
    expect((log.info as any).mock.calls[0][1]).toContain("start");
    expect((log.info as any).mock.calls[1][1]).toContain("established");
  });

  test("logs error and returns result when subscribe returns an error ExecutionResult", async () => {
    const log = makeMockLogger();
    const errorResult = { errors: [{ message: "sub failed" }] };
    const wrapped = buildTracedSubscribe(
      mock(async () => errorResult),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    const result = await wrapped(baseArgs);

    expect(result).toBe(errorResult);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect((log.error as any).mock.calls[0][0].errors).toContain("sub failed");
  });

  test("logs and rethrows when subscribeFn throws", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedSubscribe(
      mock(async () => {
        throw new Error("subscribe exploded");
      }),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
    );

    await expect(wrapped(baseArgs)).rejects.toThrow("subscribe exploded");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect((log.error as any).mock.calls[0][1]).toContain("threw");
  });
});

describe("buildTracedSubscribe — otel only", () => {
  test("creates a graphql.subscribe span and ends it after setup", async () => {
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
    );

    await wrapped(baseArgs);

    expect((tracer.startActiveSpan as any).mock.calls[0][0]).toBe(
      "graphql.subscribe",
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  test("records exception and sets error status when setup returns error result", async () => {
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const wrapped = buildTracedSubscribe(
      mock(async () => ({ errors: [{ message: "setup error" }] })),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
    );

    await wrapped(baseArgs);

    expect(span.recordException).toHaveBeenCalledTimes(1);
    expect(span.setStatus).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  test("records exception, sets error status and rethrows when subscribeFn throws", async () => {
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const wrapped = buildTracedSubscribe(
      mock(async () => {
        throw new Error("subscribe otel fail");
      }),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
    );

    await expect(wrapped(baseArgs)).rejects.toThrow("subscribe otel fail");
    expect(span.recordException).toHaveBeenCalledTimes(1);
    expect(span.setStatus).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});

describe("buildTracedSubscribe — logger + otel", () => {
  test("injects traceId and spanId into child logger by default", async () => {
    const log = makeMockLogger();
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({
        logger: { enabled: true, logger: log },
        otel: { enabled: true, tracer },
      }),
    );

    await wrapped(baseArgs);

    expect(log.child).toHaveBeenCalledTimes(1);
    const childArgs = (log.child as any).mock.calls[0][0];
    expect(childArgs.traceId).toBe("trace-abc");
    expect(childArgs.spanId).toBe("span-xyz");
  });

  test("skips traceId injection when injectTraceId is false", async () => {
    const log = makeMockLogger();
    const span = makeMockSpan();
    const tracer = makeMockTracer(span);
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({
        logger: { enabled: true, logger: log, injectTraceId: false },
        otel: { enabled: true, tracer },
      }),
    );

    await wrapped(baseArgs);

    expect(log.child).not.toHaveBeenCalled();
  });
});
