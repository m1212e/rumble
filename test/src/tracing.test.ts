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

// valid W3C ids, otherwise the otel api rejects the span context as unusable
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";

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
  const attributes: Record<string, unknown> = {};
  return {
    attributes,
    recordException: mock(() => {}),
    setStatus: mock(() => {}),
    setAttribute: mock((key: string, value: unknown) => {
      attributes[key] = value;
    }),
    setAttributes: mock((attrs: Record<string, unknown>) => {
      Object.assign(attributes, attrs);
    }),
    end: mock(() => {}),
    spanContext: () => ({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
    }),
  };
}

type StartedSpan = {
  name: string;
  options?: any;
  span: ReturnType<typeof makeMockSpan>;
};

function makeMockTracer() {
  const started: StartedSpan[] = [];

  const tracer = {
    startActiveSpan: mock((name: string, optionsOrCb: any, cb?: any) => {
      const callback = cb ?? optionsOrCb;
      const options = cb ? optionsOrCb : undefined;
      const span = makeMockSpan();
      started.push({ name, options, span });
      return callback(span);
    }),
    startSpan: mock((name: string, options?: any) => {
      const span = makeMockSpan();
      started.push({ name, options, span });
      return span;
    }),
  };

  return {
    tracer,
    started,
    /** All spans that were started under the given name. */
    byName: (name: string) => started.filter((entry) => entry.name === name),
    first: () => started[0],
  };
}

function makeRumbleInput(opts: {
  logger?: {
    enabled?: boolean;
    logger?: any;
    injectTraceId?: boolean;
    includeVariables?: any;
  };
  otel?: {
    enabled?: boolean;
    tracer?: any;
    includeVariables?: any;
    includeDocument?: boolean;
  };
}) {
  return opts as any;
}

/** Field/attribute keys of every log call, so uniformity is easy to assert. */
function logFieldsOf(logger: any, level: "info" | "error" | "debug" = "info") {
  return (logger[level] as any).mock.calls.map(([fields]: [any]) => fields);
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

const subscriptionLogFields = {
  "graphql.operation.name": "Op",
  "rumble.transport": "ws",
};

describe("wrapSubscriptionIterator", () => {
  test("passes all events through unchanged", async () => {
    const source = (async function* () {
      yield { data: { a: 1 } };
      yield { data: { a: 2 } };
    })();

    const log = makeMockLogger();
    const events = [];
    for await (const event of wrapSubscriptionIterator(source, {
      log,
      logFields: subscriptionLogFields,
      attributes: {},
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ data: { a: 1 } }, { data: { a: 2 } }]);
  });

  test("logs error for events that carry GraphQL errors", async () => {
    const source = (async function* () {
      yield { errors: [{ message: "boom" }] };
    })();

    const log = makeMockLogger();
    for await (const _ of wrapSubscriptionIterator(source as any, {
      log,
      logFields: subscriptionLogFields,
      attributes: {},
    })) {
    }

    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.error as any).mock.calls[0];
    expect(fields["graphql.operation.name"]).toBe("Op");
    expect(fields["rumble.transport"]).toBe("ws");
    expect(fields.errors[0]["exception.message"]).toBe("boom");
    expect(msg).toContain("error");
  });

  test("does not log individual successful events", async () => {
    const source = (async function* () {
      yield { data: {} };
      yield { data: {} };
    })();

    const log = makeMockLogger();
    for await (const _ of wrapSubscriptionIterator(source, {
      log,
      logFields: subscriptionLogFields,
      attributes: {},
    })) {
    }

    expect(log.info).toHaveBeenCalledTimes(1); // only the completion log
  });

  test("logs completion with event_count", async () => {
    const source = (async function* () {
      yield { data: {} };
      yield { data: {} };
      yield { data: {} };
    })();

    const log = makeMockLogger();
    for await (const _ of wrapSubscriptionIterator(source, {
      log,
      logFields: subscriptionLogFields,
      attributes: {},
    })) {
    }

    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.info as any).mock.calls[0];
    expect(fields["graphql.operation.name"]).toBe("Op");
    expect(fields.event_count).toBe(3);
    expect(msg).toContain("completed");
  });

  test("logs and rethrows when the iterator throws", async () => {
    const source = (async function* () {
      yield { data: {} };
      throw new Error("iterator error");
    })();

    const log = makeMockLogger();
    await expect(async () => {
      for await (const _ of wrapSubscriptionIterator(source, {
        log,
        logFields: subscriptionLogFields,
        attributes: {},
      })) {
      }
    }).toThrow("iterator error");

    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.error as any).mock.calls[0];
    expect(fields.errors[0]["exception.type"]).toBe("Error");
    expect(fields.errors[0]["exception.message"]).toBe("iterator error");
    expect(msg).toContain("threw");
  });

  test("records an event span for errored events, linked to the setup span", async () => {
    const source = (async function* () {
      yield { data: {} };
      yield { errors: [{ message: "boom" }] };
    })();

    const { tracer, byName } = makeMockTracer();
    const setupSpanContext = {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
    } as any;

    for await (const _ of wrapSubscriptionIterator(source as any, {
      tracer: tracer as any,
      setupSpanContext,
      logFields: subscriptionLogFields,
      attributes: { "graphql.operation.name": "Op" },
    })) {
    }

    const eventSpans = byName("graphql.subscribe.event");
    // only the errored event produces a span, the successful one stays silent
    expect(eventSpans.length).toBe(1);
    expect(eventSpans[0].options.root).toBe(true);
    expect(eventSpans[0].options.links[0].context).toBe(setupSpanContext);
    expect(eventSpans[0].options.attributes["graphql.operation.name"]).toBe(
      "Op",
    );
    expect(
      eventSpans[0].options.attributes["rumble.subscription.event_index"],
    ).toBe(2);
    expect(eventSpans[0].span.recordException).toHaveBeenCalledTimes(1);
    expect(eventSpans[0].span.setStatus).toHaveBeenCalledTimes(1);
    expect(eventSpans[0].span.end).toHaveBeenCalledTimes(1);
  });

  test("records an event span when the stream itself fails", async () => {
    const source: any = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("stream died")),
      }),
    };

    const { tracer, byName } = makeMockTracer();

    await expect(async () => {
      for await (const _ of wrapSubscriptionIterator(source, {
        tracer: tracer as any,
        logFields: subscriptionLogFields,
        attributes: {},
      })) {
      }
    }).toThrow("stream died");

    const eventSpans = byName("graphql.subscribe.event");
    expect(eventSpans.length).toBe(1);
    expect(eventSpans[0].span.recordException).toHaveBeenCalledTimes(1);
  });

  test("emits no event spans when only the logger is configured", async () => {
    const source = (async function* () {
      yield { errors: [{ message: "boom" }] };
    })();

    const log = makeMockLogger();
    for await (const _ of wrapSubscriptionIterator(source as any, {
      log,
      logFields: subscriptionLogFields,
      attributes: {},
    })) {
    }

    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

// ─── buildTracedExecute ───────────────────────────────────────────────────────

describe("buildTracedExecute — telemetry disabled", () => {
  test("hands the untouched execute function back", async () => {
    const executeFn = mock(async () => ({ data: {} }));
    const wrapped = buildTracedExecute(
      executeFn,
      makeRumbleInput({}),
      "graphql",
    );

    expect(wrapped).toBe(executeFn as any);
  });
});

describe("buildTracedExecute — logger only", () => {
  test("logs start and completion, returns result", async () => {
    const log = makeMockLogger();
    const executeFn = mock(async () => ({ data: { test: "ok" } }));

    const wrapped = buildTracedExecute(
      executeFn,
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "graphql",
    );

    const result = await wrapped(baseArgs);

    expect(result).toEqual({ data: { test: "ok" } });
    expect(executeFn).toHaveBeenCalledWith(baseArgs);
    expect(log.info).toHaveBeenCalledTimes(2);
    expect((log.info as any).mock.calls[0][1]).toContain("start");
    expect((log.info as any).mock.calls[1][1]).toContain("completed");
    expect(
      (log.info as any).mock.calls[1][0].duration_ms,
    ).toBeGreaterThanOrEqual(0);
  });

  test("tags every entry with the transport it came in through", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "rest",
    );

    await wrapped(baseArgs);

    for (const fields of logFieldsOf(log)) {
      expect(fields["rumble.transport"]).toBe("rest");
    }
  });

  test("logs error when result contains GraphQL errors", async () => {
    const log = makeMockLogger();
    const executeFn = mock(async () => ({
      errors: [{ message: "field error" }],
    })) as any;

    const wrapped = buildTracedExecute(
      executeFn,
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "graphql",
    );

    await wrapped(baseArgs);

    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = (log.error as any).mock.calls[0];
    expect(fields.errors[0]["exception.message"]).toBe("field error");
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
      "graphql",
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
      "graphql",
    );

    await wrapped({ ...baseArgs, operationName: "MyQuery" });

    for (const fields of logFieldsOf(log)) {
      expect(fields["graphql.operation.name"]).toBe("MyQuery");
    }
  });

  test("falls back to the document's operation name when none is passed", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "graphql",
    );

    await wrapped({ ...baseArgs, operationName: undefined });

    expect((log.info as any).mock.calls[0][0]["graphql.operation.name"]).toBe(
      "TestOp",
    );
  });

  test("falls back to 'anonymous' for an unnamed operation", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "graphql",
    );

    await wrapped({
      schema,
      document: parse("{ __typename }"),
      operationName: undefined,
    });

    expect((log.info as any).mock.calls[0][0]["graphql.operation.name"]).toBe(
      "anonymous",
    );
  });

  test("records the operation type", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "graphql",
    );

    await wrapped(baseArgs);

    expect((log.info as any).mock.calls[0][0]["graphql.operation.type"]).toBe(
      "query",
    );
  });

  test("includes incoming variables in the start log only", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "graphql",
    );

    await wrapped({ ...baseArgs, variableValues: { id: "42" } });

    const [start, completed] = logFieldsOf(log);
    expect(start["graphql.variables"]).toEqual({ id: "42" });
    expect(completed["graphql.variables"]).toBeUndefined();
  });

  test("omits graphql.variables when there are none", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "graphql",
    );

    await wrapped(baseArgs);

    expect(logFieldsOf(log)[0]["graphql.variables"]).toBeUndefined();
  });

  test("omits variables entirely when includeVariables is false", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        logger: { enabled: true, logger: log, includeVariables: false },
      }),
      "graphql",
    );

    await wrapped({ ...baseArgs, variableValues: { password: "hunter2" } });

    expect(logFieldsOf(log)[0]["graphql.variables"]).toBeUndefined();
  });

  test("lets a redactor drop single variables before logging", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        logger: {
          enabled: true,
          logger: log,
          includeVariables: ({ password, ...rest }: any) => rest,
        },
      }),
      "graphql",
    );

    await wrapped({
      ...baseArgs,
      variableValues: { id: "42", password: "hunter2" },
    });

    expect(logFieldsOf(log)[0]["graphql.variables"]).toEqual({ id: "42" });
  });
});

describe("buildTracedExecute — otel only", () => {
  test("creates a span with the correct name and ends it on success", async () => {
    const { tracer, first, started } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "graphql",
    );

    await wrapped(baseArgs);

    expect(started.length).toBe(1);
    expect(first().name).toBe("graphql.execute");
    expect(first().span.end).toHaveBeenCalledTimes(1);
    expect(first().span.setStatus).not.toHaveBeenCalled();
  });

  test("sets operation, document, variables and transport attributes", async () => {
    const { tracer, first } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "ws",
    );

    await wrapped({ ...baseArgs, variableValues: { id: "42", count: 2 } });

    const attributes = first().options.attributes;
    expect(attributes["graphql.operation.name"]).toBe("TestOp");
    expect(attributes["graphql.operation.type"]).toBe("query");
    expect(attributes["rumble.transport"]).toBe("ws");
    expect(attributes["graphql.document"]).toContain("__typename");
    // primitives are kept as primitives instead of being JSON encoded
    expect(attributes["graphql.variables.id"]).toBe("42");
    expect(attributes["graphql.variables.count"]).toBe(2);
  });

  test("encodes complex variables as JSON", async () => {
    const { tracer, first } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "graphql",
    );

    await wrapped({
      ...baseArgs,
      variableValues: { where: { id: { eq: 1 } }, tags: ["a", "b"] },
    });

    const attributes = first().options.attributes;
    expect(attributes["graphql.variables.where"]).toBe('{"id":{"eq":1}}');
    // homogeneous primitive arrays stay arrays, which otel supports natively
    expect(attributes["graphql.variables.tags"]).toEqual(["a", "b"]);
  });

  test("honors includeDocument and includeVariables", async () => {
    const { tracer, first } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        otel: {
          enabled: true,
          tracer,
          includeDocument: false,
          includeVariables: false,
        },
      }),
      "graphql",
    );

    await wrapped({ ...baseArgs, variableValues: { id: "42" } });

    const attributes = first().options.attributes;
    expect(attributes["graphql.document"]).toBeUndefined();
    expect(attributes["graphql.variables.id"]).toBeUndefined();
    // the identifying attributes are still there
    expect(attributes["graphql.operation.name"]).toBe("TestOp");
  });

  test("records exception and sets error status on result errors", async () => {
    const { tracer, first } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => ({ errors: [{ message: "oops" }] })) as any,
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "graphql",
    );

    await wrapped(baseArgs);

    expect(first().span.recordException).toHaveBeenCalledTimes(1);
    expect(first().span.setStatus).toHaveBeenCalledTimes(1);
    expect(first().span.end).toHaveBeenCalledTimes(1);
  });

  test("records exception, sets error status and rethrows on thrown exception", async () => {
    const { tracer, first } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => {
        throw new Error("otel fail");
      }),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "graphql",
    );

    await expect(wrapped(baseArgs)).rejects.toThrow("otel fail");
    expect(first().span.recordException).toHaveBeenCalledTimes(1);
    expect(first().span.setStatus).toHaveBeenCalledTimes(1);
    expect(first().span.end).toHaveBeenCalledTimes(1);
  });
});

describe("buildTracedExecute — logger + otel", () => {
  test("injects trace_id, span_id and trace_flags into a child logger", async () => {
    const log = makeMockLogger();
    const { tracer } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        logger: { enabled: true, logger: log },
        otel: { enabled: true, tracer },
      }),
      "graphql",
    );

    await wrapped(baseArgs);

    expect(log.child).toHaveBeenCalledTimes(1);
    const childArgs = (log.child as any).mock.calls[0][0];
    expect(childArgs.trace_id).toBe(TRACE_ID);
    expect(childArgs.span_id).toBe(SPAN_ID);
    expect(childArgs.trace_flags).toBe("01");
  });

  test("skips traceId injection when injectTraceId is false", async () => {
    const log = makeMockLogger();
    const { tracer } = makeMockTracer();
    const wrapped = buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        logger: { enabled: true, logger: log, injectTraceId: false },
        otel: { enabled: true, tracer },
      }),
      "graphql",
    );

    await wrapped(baseArgs);

    expect(log.child).not.toHaveBeenCalled();
  });
});

// ─── buildTracedSubscribe ─────────────────────────────────────────────────────

describe("buildTracedSubscribe — telemetry disabled", () => {
  test("hands the untouched subscribe function back", () => {
    const subscribeFn = mock(async () => ({ data: {} }));
    const wrapped = buildTracedSubscribe(
      subscribeFn,
      makeRumbleInput({}),
      "ws",
    );

    expect(wrapped).toBe(subscribeFn as any);
  });
});

describe("buildTracedSubscribe — logger only", () => {
  test("logs subscribe start and established, returns wrapped iterator", async () => {
    const log = makeMockLogger();
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "ws",
    );

    const result = await wrapped(baseArgs);

    expect(isAsyncIterable(result)).toBe(true);
    expect(log.info).toHaveBeenCalledTimes(2);
    expect((log.info as any).mock.calls[0][1]).toContain("start");
    expect((log.info as any).mock.calls[1][1]).toContain("established");
  });

  test("tags entries with the transport and the incoming variables", async () => {
    const log = makeMockLogger();
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "ws",
    );

    await wrapped({ ...baseArgs, variableValues: { id: "42" } });

    const [start] = logFieldsOf(log);
    expect(start["rumble.transport"]).toBe("ws");
    expect(start["graphql.variables"]).toEqual({ id: "42" });
  });

  test("logs error and returns result when subscribe returns an error ExecutionResult", async () => {
    const log = makeMockLogger();
    const errorResult = { errors: [{ message: "sub failed" }] };
    const wrapped = buildTracedSubscribe(
      mock(async () => errorResult) as any,
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "ws",
    );

    const result = await wrapped(baseArgs);

    expect(result).toBe(errorResult as any);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(
      (log.error as any).mock.calls[0][0].errors[0]["exception.message"],
    ).toBe("sub failed");
  });

  test("logs and rethrows when subscribeFn throws", async () => {
    const log = makeMockLogger();
    const wrapped = buildTracedSubscribe(
      mock(async () => {
        throw new Error("subscribe exploded");
      }),
      makeRumbleInput({ logger: { enabled: true, logger: log } }),
      "ws",
    );

    await expect(wrapped(baseArgs)).rejects.toThrow("subscribe exploded");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect((log.error as any).mock.calls[0][1]).toContain("threw");
  });
});

describe("buildTracedSubscribe — otel only", () => {
  test("creates a graphql.subscribe span and ends it after setup", async () => {
    const { tracer, first } = makeMockTracer();
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "ws",
    );

    await wrapped(baseArgs);

    expect(first().name).toBe("graphql.subscribe");
    expect(first().span.end).toHaveBeenCalledTimes(1);
  });

  test("sets the same attribute keys as the execute span", async () => {
    const executeTracer = makeMockTracer();
    const subscribeTracer = makeMockTracer();
    const args = { ...baseArgs, variableValues: { id: "42" } };

    await buildTracedExecute(
      mock(async () => ({ data: {} })),
      makeRumbleInput({
        otel: { enabled: true, tracer: executeTracer.tracer },
      }),
      "graphql",
    )(args);

    const source = (async function* () {
      yield { data: {} };
    })();
    await buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({
        otel: { enabled: true, tracer: subscribeTracer.tracer },
      }),
      "graphql",
    )(args);

    expect(
      Object.keys(subscribeTracer.first().options.attributes).sort(),
    ).toEqual(Object.keys(executeTracer.first().options.attributes).sort());
  });

  test("records exception and sets error status when setup returns error result", async () => {
    const { tracer, first } = makeMockTracer();
    const wrapped = buildTracedSubscribe(
      mock(async () => ({ errors: [{ message: "setup error" }] })) as any,
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "ws",
    );

    await wrapped(baseArgs);

    expect(first().span.recordException).toHaveBeenCalledTimes(1);
    expect(first().span.setStatus).toHaveBeenCalledTimes(1);
    expect(first().span.end).toHaveBeenCalledTimes(1);
  });

  test("records exception, sets error status and rethrows when subscribeFn throws", async () => {
    const { tracer, first } = makeMockTracer();
    const wrapped = buildTracedSubscribe(
      mock(async () => {
        throw new Error("subscribe otel fail");
      }),
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "ws",
    );

    await expect(wrapped(baseArgs)).rejects.toThrow("subscribe otel fail");
    expect(first().span.recordException).toHaveBeenCalledTimes(1);
    expect(first().span.setStatus).toHaveBeenCalledTimes(1);
    expect(first().span.end).toHaveBeenCalledTimes(1);
  });

  test("event errors are recorded even without a logger", async () => {
    const { tracer, byName } = makeMockTracer();
    const source = (async function* () {
      yield { errors: [{ message: "event boom" }] };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source) as any,
      makeRumbleInput({ otel: { enabled: true, tracer } }),
      "ws",
    );

    const result = (await wrapped(baseArgs)) as AsyncIterable<any>;
    for await (const _ of result) {
    }

    const eventSpans = byName("graphql.subscribe.event");
    expect(eventSpans.length).toBe(1);
    expect(eventSpans[0].options.links[0].context.traceId).toBe(TRACE_ID);
    expect(eventSpans[0].span.recordException).toHaveBeenCalledTimes(1);
  });
});

describe("buildTracedSubscribe — logger + otel", () => {
  test("injects trace_id and span_id into child logger by default", async () => {
    const log = makeMockLogger();
    const { tracer } = makeMockTracer();
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({
        logger: { enabled: true, logger: log },
        otel: { enabled: true, tracer },
      }),
      "ws",
    );

    await wrapped(baseArgs);

    expect(log.child).toHaveBeenCalledTimes(1);
    const childArgs = (log.child as any).mock.calls[0][0];
    expect(childArgs.trace_id).toBe(TRACE_ID);
    expect(childArgs.span_id).toBe(SPAN_ID);
    expect(childArgs.trace_flags).toBe("01");
  });

  test("skips traceId injection when injectTraceId is false", async () => {
    const log = makeMockLogger();
    const { tracer } = makeMockTracer();
    const source = (async function* () {
      yield { data: {} };
    })();
    const wrapped = buildTracedSubscribe(
      mock(async () => source),
      makeRumbleInput({
        logger: { enabled: true, logger: log, injectTraceId: false },
        otel: { enabled: true, tracer },
      }),
      "ws",
    );

    await wrapped(baseArgs);

    expect(log.child).not.toHaveBeenCalled();
  });
});
