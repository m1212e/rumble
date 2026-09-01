import { describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import {
  type Context,
  context as otelContext,
  ROOT_CONTEXT,
  trace,
} from "@opentelemetry/api";
import { parse } from "graphql";
import { rumble } from "../../lib";
import type { DB } from "./db/db";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";

/**
 * The point of this suite: an operation must produce the same spans, the same
 * attribute keys and the same log fields no matter whether it arrived over the
 * GraphQL endpoint, the SOFA REST adapter or a WebSocket. Only
 * `rumble.transport` may differ.
 */

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";

/**
 * The otel api only tracks an active span when a context manager is installed —
 * the node SDK ships one, so this mirrors a realistic setup and lets us assert
 * that log lines outside the operation wrapper (abilities, resolvers) really do
 * pick up the surrounding span.
 */
class AsyncLocalStorageContextManager {
  private storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(context, () => fn.call(thisArg as any, ...args));
  }

  bind<T>(_context: Context, target: T): T {
    return target;
  }

  enable() {
    return this;
  }

  disable() {
    this.storage.disable();
    return this;
  }
}

otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager());

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  status?: unknown;
  exceptions: unknown[];
  links: unknown[];
  ended: boolean;
};

function makeRecordingTracer() {
  const spans: RecordedSpan[] = [];

  const makeSpan = (name: string, options?: any): any => {
    const recorded: RecordedSpan = {
      name,
      attributes: { ...(options?.attributes ?? {}) },
      exceptions: [],
      links: options?.links ?? [],
      ended: false,
    };
    spans.push(recorded);

    return {
      setAttribute: (key: string, value: unknown) => {
        recorded.attributes[key] = value;
      },
      setAttributes: (attrs: Record<string, unknown>) => {
        Object.assign(recorded.attributes, attrs);
      },
      addEvent: () => {},
      setStatus: (status: unknown) => {
        recorded.status = status;
      },
      recordException: (error: unknown) => {
        recorded.exceptions.push(error);
      },
      updateName: (next: string) => {
        recorded.name = next;
      },
      isRecording: () => true,
      end: () => {
        recorded.ended = true;
      },
      spanContext: () => ({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        traceFlags: 1,
      }),
    };
  };

  const tracer = {
    startSpan: (name: string, options?: any) => makeSpan(name, options),
    startActiveSpan: (
      name: string,
      optionsOrCb: any,
      cbOrCtx?: any,
      cb?: any,
    ) => {
      const callback =
        typeof optionsOrCb === "function"
          ? optionsOrCb
          : typeof cbOrCtx === "function"
            ? cbOrCtx
            : cb;
      const options =
        typeof optionsOrCb === "function" ? undefined : optionsOrCb;
      const span = makeSpan(name, options);
      // a real tracer makes the span active for the callback, which is what
      // trace.getActiveSpan() based log correlation relies on
      return otelContext.with(trace.setSpan(otelContext.active(), span), () =>
        callback(span),
      );
    },
  };

  return {
    tracer: tracer as any,
    spans,
    named: (name: string) => spans.filter((span) => span.name === name),
  };
}

function makeRecordingLogger() {
  const entries: {
    level: string;
    fields: Record<string, unknown>;
    msg: string;
  }[] = [];

  const make = (bindings: Record<string, unknown>): any => {
    const emit =
      (level: string) => (fields: Record<string, unknown>, msg: string) => {
        entries.push({ level, fields: { ...bindings, ...fields }, msg });
      };
    return {
      info: emit("info"),
      warn: emit("warn"),
      error: emit("error"),
      debug: emit("debug"),
      child: (childBindings: Record<string, unknown>) =>
        make({ ...bindings, ...childBindings }),
    };
  };

  return { logger: make({}), entries };
}

function makeInstance(db: DB, tracer: any, logger: any) {
  const r = rumble({
    db,
    schema,
    defaultLimit: null,
    context() {
      return { userId: "123" };
    },
    otel: { enabled: true, tracer },
    logger: { enabled: true, logger },
  });

  r.object({ table: "users" });
  r.query({ table: "users" });
  // relations of users, needed so the schema can be built
  r.object({ refName: "Post", table: "posts" });
  r.object({ refName: "Comment", table: "comments" });
  r.abilityBuilder.users.allow(["read"]);
  r.abilityBuilder.posts.allow(["read"]);
  r.abilityBuilder.comments.allow(["read"]);

  return r;
}

const usersQuery = /* GraphQL */ `
  query UsersWithLimit($limit: Int) {
    users(limit: $limit) {
      id
    }
  }
`;

/** Runs the users query over the GraphQL endpoint. */
async function viaGraphql(db: DB) {
  const { tracer, spans, named } = makeRecordingTracer();
  const { logger, entries } = makeRecordingLogger();
  const r = makeInstance(db, tracer, logger);

  const executor = buildHTTPExecutor({
    fetch: r.createYoga().fetch,
    endpoint: "http://yoga/graphql",
  });
  const result: any = await executor({
    document: parse(usersQuery),
    variables: { limit: 1 },
  });

  expect(result.errors).toBeUndefined();
  return { spans, named, entries };
}

/** Runs the equivalent request over the generated REST API. */
async function viaRest(db: DB) {
  const { tracer, spans, named } = makeRecordingTracer();
  const { logger, entries } = makeRecordingLogger();
  const r = makeInstance(db, tracer, logger);

  const sofa = await r.createSofa({ basePath: "/api" });
  const response = await sofa.handleRequest(
    new Request("http://localhost/api/users?limit=1"),
    {},
  );

  expect(response.status).toBe(200);
  return { spans, named, entries };
}

/** Runs the same operation through the WebSocket handler's execute. */
async function viaWs(db: DB) {
  const { tracer, spans, named } = makeRecordingTracer();
  const { logger, entries } = makeRecordingLogger();
  const r = makeInstance(db, tracer, logger);

  // the ws implementation is injected by the caller, so a passthrough gives us
  // the very options graphql-ws would have been handed
  const options: any = r.createWs((injected: any) => injected, {} as any);
  const result: any = await options.execute({
    schema: r.buildSchema(),
    document: parse(usersQuery),
    contextValue: await options.context({}),
    variableValues: { limit: 1 },
    operationName: "UsersWithLimit",
  });

  expect(result.errors).toBeUndefined();
  return { spans, named, entries };
}

function executeSpanOf(named: (name: string) => RecordedSpan[]) {
  const spans = named("graphql.execute");
  expect(spans.length).toBe(1);
  return spans[0];
}

function entryFieldsOf(
  entries: { fields: Record<string, unknown>; msg: string }[],
  msg: string,
) {
  const matching = entries.filter((entry) => entry.msg === msg);
  expect(matching.length).toBe(1);
  return matching[0].fields;
}

describe("telemetry is uniform across transports", async () => {
  const { db } = await makeSeededDBInstanceForTest();

  const graphql = await viaGraphql(db);
  const rest = await viaRest(db);
  const ws = await viaWs(db);
  const all = [
    ["graphql", graphql],
    ["rest", rest],
    ["ws", ws],
  ] as const;

  test("every transport produces exactly one graphql.execute span", () => {
    for (const [, run] of all) {
      expect(run.named("graphql.execute").length).toBe(1);
    }
  });

  test("the execute spans carry the same attribute keys everywhere", () => {
    const keySets = all.map(([, run]) =>
      Object.keys(executeSpanOf(run.named).attributes).sort(),
    );

    expect(keySets[1]).toEqual(keySets[0]);
    expect(keySets[2]).toEqual(keySets[0]);
    // and those keys are the documented contract
    expect(keySets[0]).toEqual([
      "graphql.document",
      "graphql.operation.name",
      "graphql.operation.type",
      "graphql.variables.limit",
      "rumble.transport",
    ]);
  });

  test("each execute span names its own transport", () => {
    for (const [transport, run] of all) {
      expect(executeSpanOf(run.named).attributes["rumble.transport"]).toBe(
        transport,
      );
    }
  });

  test("the operation type is resolved for every transport", () => {
    for (const [, run] of all) {
      expect(
        executeSpanOf(run.named).attributes["graphql.operation.type"],
      ).toBe("query");
    }
  });

  test("the incoming variables reach the span for every transport", () => {
    for (const [, run] of all) {
      expect(
        executeSpanOf(run.named).attributes["graphql.variables.limit"],
      ).toBe(1);
    }
  });

  test("every execute span is ended and left without an error status", () => {
    for (const [, run] of all) {
      const span = executeSpanOf(run.named);
      expect(span.ended).toBe(true);
      expect(span.status).toBeUndefined();
      expect(span.exceptions).toEqual([]);
    }
  });

  test("the ability spans are emitted for every transport", () => {
    for (const [, run] of all) {
      const spans = run.named("rumble.abilities.prepare");
      expect(spans.length).toBeGreaterThan(0);
      expect(spans[0].attributes["rumble.table"]).toBe("users");
      expect(spans[0].attributes["rumble.action"]).toBe("read");
      // a plain allow() is a wildcard, so no filters have to be applied
      expect(spans[0].attributes["rumble.abilities.status"]).toBe(
        "unrestricted",
      );
    }
  });

  test("the start log carries the same fields everywhere", () => {
    const keySets = all.map(([, run]) =>
      Object.keys(entryFieldsOf(run.entries, "graphql execute start")).sort(),
    );

    expect(keySets[1]).toEqual(keySets[0]);
    expect(keySets[2]).toEqual(keySets[0]);
    expect(keySets[0]).toEqual([
      "graphql.operation.name",
      "graphql.operation.type",
      "graphql.variables",
      "rumble.transport",
      "span_id",
      "trace_flags",
      "trace_id",
    ]);
  });

  test("the completion log carries the same fields everywhere", () => {
    const keySets = all.map(([, run]) =>
      Object.keys(
        entryFieldsOf(run.entries, "graphql execute completed"),
      ).sort(),
    );

    expect(keySets[1]).toEqual(keySets[0]);
    expect(keySets[2]).toEqual(keySets[0]);
    expect(keySets[0]).toEqual([
      "duration_ms",
      "graphql.operation.name",
      "graphql.operation.type",
      "rumble.transport",
      "span_id",
      "trace_flags",
      "trace_id",
    ]);
  });

  test("every log entry of an operation is trace correlated", () => {
    for (const [, run] of all) {
      const operationEntries = run.entries.filter((entry) =>
        entry.msg.startsWith("graphql execute"),
      );
      expect(operationEntries.length).toBeGreaterThan(0);
      for (const entry of operationEntries) {
        expect(entry.fields.trace_id).toBe(TRACE_ID);
        expect(entry.fields.span_id).toBe(SPAN_ID);
        expect(entry.fields.trace_flags).toBe("01");
      }
    }
  });

  test("ability and resolver logs are trace correlated too", () => {
    for (const [, run] of all) {
      const others = run.entries.filter(
        (entry) =>
          entry.msg === "abilities prepared" ||
          entry.msg === "resolver completed",
      );
      expect(others.length).toBeGreaterThan(0);
      for (const entry of others) {
        expect(entry.fields.trace_id).toBe(TRACE_ID);
      }
    }
  });

  test("the transport is part of every operation log entry", () => {
    for (const [transport, run] of all) {
      const operationEntries = run.entries.filter((entry) =>
        entry.msg.startsWith("graphql execute"),
      );
      for (const entry of operationEntries) {
        expect(entry.fields["rumble.transport"]).toBe(transport);
      }
    }
  });
});

describe("telemetry stays out of the way when disabled", async () => {
  const { db } = await makeSeededDBInstanceForTest();

  test("execute is not wrapped at all", async () => {
    const r = rumble({
      db,
      schema,
      defaultLimit: null,
      context() {
        return { userId: "123" };
      },
    });
    r.object({ table: "users" });
    r.query({ table: "users" });
    r.object({ refName: "Post", table: "posts" });
    r.object({ refName: "Comment", table: "comments" });
    r.abilityBuilder.users.allow(["read"]);

    const passthrough = mock(async () => ({ data: { users: [] } }));
    const options: any = r.createWs((injected: any) => injected, {
      execute: passthrough,
    } as any);

    expect(options.execute).toBe(passthrough);
  });
});
