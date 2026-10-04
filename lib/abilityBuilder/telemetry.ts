import type { AttributeValue, Span } from "@opentelemetry/api";
import { debounce } from "es-toolkit";
import { errorLogField } from "../helpers/errorLogging";
import {
  ATTR_ACTION,
  ATTR_TABLE,
  recordSpanError,
  SPAN_ABILITIES_PREPARE,
  type TelemetryConfig,
  traceCorrelationFields,
} from "../helpers/telemetry";
import type { RumbleLogger } from "../types/rumbleInput";
import type { AbilitySettings } from "./types";

export const makeNothingRegisteredWarner = (
  config: TelemetryConfig,
  logger?: RumbleLogger,
) =>
  debounce((model: string, action: string) => {
    const msg = `No abilities registered for ${model}/${action} — blocking everything. Register the ability or ignore this warning if intentional.`;
    if (logger) {
      logger.warn(
        {
          [ATTR_TABLE]: model,
          [ATTR_ACTION]: action,
          ...traceCorrelationFields(config),
        },
        msg,
      );
    } else {
      console.warn(msg);
    }
  }, 1000);

/**
 * Runs the preparation of the abilities of one table and action, reporting
 * the attributes it collects to the span and the logger.
 */
export function traceAbilityPreparation<T>(
  { otel, log, telemetryConfig }: AbilitySettings<any, any>,
  tableName: string,
  action: string,
  assemble: (attributes: Record<string, AttributeValue>) => Promise<T>,
): Promise<T> {
  // one attribute set, fed to both sinks, so a trace and a log
  // line describing the same ability check cannot disagree
  const run = async (span?: Span) => {
    const attributes: Record<string, AttributeValue> = {
      [ATTR_TABLE]: tableName,
      [ATTR_ACTION]: action,
    };

    try {
      const result = await assemble(attributes);
      log?.debug(
        {
          ...attributes,
          ...traceCorrelationFields(telemetryConfig, span),
        },
        "abilities prepared",
      );
      return result;
    } catch (error) {
      recordSpanError(span, error);
      log?.error(
        {
          ...attributes,
          ...traceCorrelationFields(telemetryConfig, span),
          ...errorLogField(error),
        },
        "abilities failed",
      );
      throw error;
    } finally {
      span?.setAttributes(attributes);
    }
  };

  if (otel?.enabled && otel.tracer) {
    return otel.tracer.startActiveSpan(SPAN_ABILITIES_PREPARE, async (span) => {
      try {
        return await run(span);
      } finally {
        span.end();
      }
    });
  }

  return run();
}
