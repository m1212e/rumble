import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { AttributeNames, SpanNames } from "@pothos/tracing-opentelemetry";
import {
  execute as defaultExecute,
  subscribe as defaultSubscribe,
  type ExecutionArgs,
  type ExecutionResult,
} from "graphql";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
  RumbleLogger,
} from "../types/rumbleInput";

export function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

export async function* wrapSubscriptionIterator(
  iterator: AsyncIterable<ExecutionResult>,
  log: RumbleLogger,
  operationName: string,
): AsyncGenerator<ExecutionResult> {
  let eventCount = 0;
  try {
    for await (const event of iterator) {
      eventCount++;
      if (event.errors?.length) {
        log.error(
          {
            "graphql.operation.name": operationName,
            eventCount,
            errors: event.errors.map((e: { message: string }) => e.message),
          },
          "graphql subscription event error",
        );
      }
      yield event;
    }
    log.info(
      { "graphql.operation.name": operationName, eventCount },
      "graphql subscription completed",
    );
  } catch (error) {
    log.error(
      { "graphql.operation.name": operationName, eventCount, err: error },
      "graphql subscription threw",
    );
    throw error;
  }
}

export function buildTracedExecute<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>(
  executeFn: (
    args: ExecutionArgs,
  ) => Promise<ExecutionResult> | ExecutionResult,
  rumbleInput: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>,
): (args: ExecutionArgs) => Promise<ExecutionResult> {
  return async (options: ExecutionArgs): Promise<ExecutionResult> => {
    let log = rumbleInput.logger?.enabled
      ? rumbleInput.logger.logger
      : undefined;
    const operationName = options.operationName ?? "anonymous";
    const start = Date.now();

    log?.info(
      { "graphql.operation.name": operationName },
      "graphql execute start",
    );

    const run = async () => {
      const result = await executeFn(options);
      if (result && "errors" in result && result.errors?.length) {
        log?.error(
          {
            "graphql.operation.name": operationName,
            durationMs: Date.now() - start,
            errors: result.errors.map((e: { message: string }) => e.message),
          },
          "graphql execute completed with errors",
        );
      } else {
        log?.info(
          {
            "graphql.operation.name": operationName,
            durationMs: Date.now() - start,
          },
          "graphql execute completed",
        );
      }
      return result;
    };

    if (rumbleInput.otel?.enabled) {
      return rumbleInput.otel.tracer!.startActiveSpan(
        SpanNames.EXECUTE,
        {
          attributes: {
            [AttributeNames.OPERATION_NAME]: operationName,
            [AttributeNames.SOURCE]: options.document as any,
          },
        },
        async (span: Span) => {
          if (log && rumbleInput.logger?.injectTraceId !== false) {
            const { traceId, spanId } = span.spanContext();
            log = log.child({ traceId, spanId });
          }
          try {
            const result = await run();
            if (result && "errors" in result && result.errors?.length) {
              for (const error of result.errors) span.recordException(error);
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
            return result;
          } catch (error) {
            if (error instanceof Error) span.recordException(error);
            log?.error(
              {
                "graphql.operation.name": operationName,
                durationMs: Date.now() - start,
                err: error,
              },
              "graphql execute threw",
            );
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    }

    try {
      return await run();
    } catch (error) {
      log?.error(
        {
          "graphql.operation.name": operationName,
          durationMs: Date.now() - start,
          err: error,
        },
        "graphql execute threw",
      );
      throw error;
    }
  };
}

export function buildTracedSubscribe<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>(
  subscribeFn: (
    args: ExecutionArgs,
  ) =>
    | Promise<AsyncIterable<ExecutionResult> | ExecutionResult>
    | AsyncIterable<ExecutionResult>
    | ExecutionResult,
  rumbleInput: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>,
): (
  args: ExecutionArgs,
) => Promise<AsyncIterable<ExecutionResult> | ExecutionResult> {
  return async (
    options: ExecutionArgs,
  ): Promise<AsyncIterable<ExecutionResult> | ExecutionResult> => {
    let log = rumbleInput.logger?.enabled
      ? rumbleInput.logger.logger
      : undefined;
    const operationName = options.operationName ?? "anonymous";
    const start = Date.now();

    const doSubscribe = async (): Promise<
      AsyncIterable<ExecutionResult> | ExecutionResult
    > => {
      log?.info(
        { "graphql.operation.name": operationName },
        "graphql subscribe start",
      );

      const result = await subscribeFn(options);

      if (!isAsyncIterable(result)) {
        const execResult = result as ExecutionResult;
        if (execResult.errors?.length) {
          log?.error(
            {
              "graphql.operation.name": operationName,
              durationMs: Date.now() - start,
              errors: execResult.errors.map(
                (e: { message: string }) => e.message,
              ),
            },
            "graphql subscribe completed with errors",
          );
        }
        return execResult;
      }

      log?.info(
        {
          "graphql.operation.name": operationName,
          durationMs: Date.now() - start,
        },
        "graphql subscription established",
      );

      if (log) {
        return wrapSubscriptionIterator(
          result as AsyncIterable<ExecutionResult>,
          log,
          operationName,
        );
      }
      return result;
    };

    if (rumbleInput.otel?.enabled) {
      return rumbleInput.otel.tracer!.startActiveSpan(
        "graphql.subscribe",
        async (span: Span) => {
          if (log && rumbleInput.logger?.injectTraceId !== false) {
            const { traceId, spanId } = span.spanContext();
            log = log.child({ traceId, spanId });
          }
          try {
            const result = await doSubscribe();
            if (!isAsyncIterable(result)) {
              const execResult = result as ExecutionResult;
              if (execResult.errors?.length) {
                for (const error of execResult.errors)
                  span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR });
              }
            }
            return result;
          } catch (error) {
            if (error instanceof Error) span.recordException(error);
            log?.error(
              {
                "graphql.operation.name": operationName,
                durationMs: Date.now() - start,
                err: error,
              },
              "graphql subscribe threw",
            );
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    }

    try {
      return await doSubscribe();
    } catch (error) {
      log?.error(
        {
          "graphql.operation.name": operationName,
          durationMs: Date.now() - start,
          err: error,
        },
        "graphql subscribe threw",
      );
      throw error;
    }
  };
}

export { defaultExecute, defaultSubscribe };
