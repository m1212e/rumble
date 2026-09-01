import type { Attributes, Span, SpanContext, Tracer } from "@opentelemetry/api";
import {
  execute as defaultExecute,
  subscribe as defaultSubscribe,
  type ExecutionArgs,
  type ExecutionResult,
  getOperationAST,
  print,
} from "graphql";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
  RumbleLogger,
} from "../types/rumbleInput";
import { errorLogField, errorsLogField } from "./errorLogging";
import {
  ATTR_DOCUMENT,
  ATTR_OPERATION_NAME,
  ATTR_OPERATION_TYPE,
  ATTR_SUBSCRIPTION_EVENT_INDEX,
  ATTR_TRANSPORT,
  durationMs,
  FIELD_DURATION_MS,
  FIELD_EVENT_COUNT,
  type RumbleTransport,
  recordSpanError,
  recordSpanErrors,
  SPAN_EXECUTE,
  SPAN_SUBSCRIBE,
  SPAN_SUBSCRIBE_EVENT,
  startTimer,
  type TelemetryConfig,
  telemetryEnabled,
  telemetryLogger,
  telemetryTracer,
  traceCorrelationFields,
  variableAttributes,
  variableLogField,
} from "./telemetry";

export function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

/**
 * Everything the operation telemetry of a single execute/subscribe call needs.
 * Built once per operation so spans and logs cannot drift apart, and so the three
 * transports (GraphQL, SOFA REST, WebSocket) share one code path.
 */
type OperationTelemetry = {
  operationName: string;
  operationType?: string;
  /** Identical keys for spans and logs, minus the payload specific ones. */
  logFields: Record<string, unknown>;
  /** Only on the "start" entry, so variables are not repeated on every line. */
  variableLogFields: Record<string, unknown>;
  /** Lazy: printing the document and encoding variables is only worth it for otel. */
  attributes: () => Attributes;
};

function buildOperationTelemetry(
  config: TelemetryConfig,
  transport: RumbleTransport,
  options: ExecutionArgs,
): OperationTelemetry {
  const operationAst = getOperationAST(options.document, options.operationName);
  const operationName =
    options.operationName ?? operationAst?.name?.value ?? "anonymous";
  const operationType = operationAst?.operation;

  const logFields = {
    [ATTR_OPERATION_NAME]: operationName,
    ...(operationType ? { [ATTR_OPERATION_TYPE]: operationType } : {}),
    [ATTR_TRANSPORT]: transport,
  };

  return {
    operationName,
    operationType,
    logFields,
    variableLogFields: variableLogField(
      options.variableValues,
      config.logger?.includeVariables,
    ),
    attributes: () => ({
      ...(logFields as Attributes),
      ...(config.otel?.includeDocument === false
        ? {}
        : { [ATTR_DOCUMENT]: print(options.document) }),
      ...variableAttributes(
        options.variableValues,
        config.otel?.includeVariables,
      ),
    }),
  };
}

/**
 * Wraps a subscription's event stream so delivered events are observable no
 * matter which transport consumes them.
 */
export async function* wrapSubscriptionIterator(
  iterator: AsyncIterable<ExecutionResult>,
  telemetry: {
    log?: RumbleLogger;
    tracer?: Tracer;
    setupSpanContext?: SpanContext;
    logFields: Record<string, unknown>;
    attributes: Attributes;
  },
): AsyncGenerator<ExecutionResult> {
  const { log, tracer, setupSpanContext, logFields, attributes } = telemetry;

  const recordEventErrors = (
    eventCount: number,
    errors: readonly unknown[],
  ) => {
    if (!tracer) return;
    const span = tracer.startSpan(SPAN_SUBSCRIBE_EVENT, {
      root: true,
      links: setupSpanContext ? [{ context: setupSpanContext }] : undefined,
      attributes: {
        ...attributes,
        [ATTR_SUBSCRIPTION_EVENT_INDEX]: eventCount,
      },
    });
    recordSpanErrors(span, errors);
    span.end();
  };

  let eventCount = 0;
  try {
    for await (const event of iterator) {
      eventCount++;
      if (event.errors?.length) {
        log?.error(
          {
            ...logFields,
            [FIELD_EVENT_COUNT]: eventCount,
            ...errorsLogField(event.errors),
          },
          "graphql subscription event error",
        );
        recordEventErrors(eventCount, event.errors);
      }
      yield event;
    }
    log?.info(
      {
        ...logFields,
        [FIELD_EVENT_COUNT]: eventCount,
      },
      "graphql subscription completed",
    );
  } catch (error) {
    log?.error(
      {
        ...logFields,
        [FIELD_EVENT_COUNT]: eventCount,
        ...errorLogField(error),
      },
      "graphql subscription threw",
    );
    recordEventErrors(eventCount, [error]);
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
  transport: RumbleTransport,
): (args: ExecutionArgs) => Promise<ExecutionResult> {
  if (!telemetryEnabled(rumbleInput)) {
    return executeFn as (args: ExecutionArgs) => Promise<ExecutionResult>;
  }

  return async (options: ExecutionArgs): Promise<ExecutionResult> => {
    const tracer = telemetryTracer(rumbleInput);
    let log = telemetryLogger(rumbleInput);
    const telemetry = buildOperationTelemetry(rumbleInput, transport, options);
    const start = startTimer();

    const run = async (span?: Span) => {
      log?.info(
        { ...telemetry.logFields, ...telemetry.variableLogFields },
        "graphql execute start",
      );

      try {
        const result = await executeFn(options);

        if (result && "errors" in result && result.errors?.length) {
          log?.error(
            {
              ...telemetry.logFields,
              [FIELD_DURATION_MS]: durationMs(start),
              ...errorsLogField(result.errors),
            },
            "graphql execute completed with errors",
          );
          recordSpanErrors(span, result.errors);
        } else {
          log?.info(
            {
              ...telemetry.logFields,
              [FIELD_DURATION_MS]: durationMs(start),
            },
            "graphql execute completed",
          );
        }

        return result;
      } catch (error) {
        log?.error(
          {
            ...telemetry.logFields,
            [FIELD_DURATION_MS]: durationMs(start),
            ...errorLogField(error),
          },
          "graphql execute threw",
        );
        recordSpanError(span, error);
        throw error;
      }
    };

    if (!tracer) return run();

    return tracer.startActiveSpan(
      SPAN_EXECUTE,
      { attributes: telemetry.attributes() },
      async (span: Span) => {
        if (log) {
          const correlation = traceCorrelationFields(rumbleInput, span);
          if (Object.keys(correlation).length > 0) {
            log = log.child(correlation);
          }
        }
        try {
          return await run(span);
        } finally {
          span.end();
        }
      },
    );
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
  transport: RumbleTransport,
): (
  args: ExecutionArgs,
) => Promise<AsyncIterable<ExecutionResult> | ExecutionResult> {
  if (!telemetryEnabled(rumbleInput)) {
    return subscribeFn as (
      args: ExecutionArgs,
    ) => Promise<AsyncIterable<ExecutionResult> | ExecutionResult>;
  }

  return async (
    options: ExecutionArgs,
  ): Promise<AsyncIterable<ExecutionResult> | ExecutionResult> => {
    const tracer = telemetryTracer(rumbleInput);
    let log = telemetryLogger(rumbleInput);
    const telemetry = buildOperationTelemetry(rumbleInput, transport, options);
    const start = startTimer();
    // Built once so the event spans carry the same attributes as the setup span.
    const attributes = tracer ? telemetry.attributes() : {};

    const doSubscribe = async (
      span?: Span,
    ): Promise<AsyncIterable<ExecutionResult> | ExecutionResult> => {
      log?.info(
        { ...telemetry.logFields, ...telemetry.variableLogFields },
        "graphql subscribe start",
      );

      try {
        const result = await subscribeFn(options);

        if (!isAsyncIterable(result)) {
          const execResult = result as ExecutionResult;
          if (execResult.errors?.length) {
            log?.error(
              {
                ...telemetry.logFields,
                [FIELD_DURATION_MS]: durationMs(start),
                ...errorsLogField(execResult.errors),
              },
              "graphql subscribe completed with errors",
            );
            recordSpanErrors(span, execResult.errors);
          }
          return execResult;
        }

        log?.info(
          {
            ...telemetry.logFields,
            [FIELD_DURATION_MS]: durationMs(start),
          },
          "graphql subscription established",
        );

        return wrapSubscriptionIterator(
          result as AsyncIterable<ExecutionResult>,
          {
            log,
            tracer,
            setupSpanContext: span?.spanContext(),
            logFields: telemetry.logFields,
            attributes,
          },
        );
      } catch (error) {
        log?.error(
          {
            ...telemetry.logFields,
            [FIELD_DURATION_MS]: durationMs(start),
            ...errorLogField(error),
          },
          "graphql subscribe threw",
        );
        recordSpanError(span, error);
        throw error;
      }
    };

    if (!tracer) return doSubscribe();

    return tracer.startActiveSpan(
      SPAN_SUBSCRIBE,
      { attributes },
      async (span: Span) => {
        if (log) {
          const correlation = traceCorrelationFields(rumbleInput, span);
          if (Object.keys(correlation).length > 0) {
            log = log.child(correlation);
          }
        }
        try {
          return await doSubscribe(span);
        } finally {
          // Ends after setup, not after the last event: a span kept open for the
          // lifetime of a subscription would never be exported in time.
          span.end();
        }
      },
    );
  };
}

export { defaultExecute, defaultSubscribe };
