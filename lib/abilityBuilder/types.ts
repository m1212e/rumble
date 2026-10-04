import type { tableHelper } from "../helpers/tableHelpers";
import type { TelemetryConfig } from "../helpers/telemetry";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import type { RumbleLogger } from "../types/rumbleInput";

/**
 * Settings shared by all parts of the ability builder, resolved once from the
 * rumble input.
 */
export type AbilitySettings<
  DB extends DrizzleInstance,
  Action extends string,
> = {
  db: DB;
  actions: Action[];
  defaultLimit: number | undefined | null;
  otel: TelemetryConfig["otel"];
  telemetryConfig: TelemetryConfig;
  log: RumbleLogger | undefined;
  warnNothingRegistered: (model: string, action: string) => void;
};

export type TableSchema = ReturnType<typeof tableHelper>;
