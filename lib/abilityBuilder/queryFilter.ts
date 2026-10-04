import type {
  DrizzleInstance,
  DrizzleQueryFunction,
  DrizzleQueryFunctionInput,
} from "../types/drizzleInstanceType";

/**
 * Static, non changing query filter input type for a specific table
 */
export type StaticQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
> = Filter;

/**
 * Dynamic, context based query filter input type for a specific table
 */
export type DynamicQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
> = (
  context: Context,
) =>
  | StaticQueryFilter<DB, Table, Filter>
  | undefined
  | "allow"
  | Promise<StaticQueryFilter<DB, Table, Filter> | undefined | "allow">;

/**
 * Combined query filter type for a specific table. May be static or dynamic.
 */
export type QueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
> =
  | StaticQueryFilter<DB, Table, Filter>
  | DynamicQueryFilter<DB, Table, Filter, Context>;

/**
 * The query filters registered per action. "unrestricted" when a bare allow()
 * granted the action without conditions.
 */
export type QueryFilterRegistry<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  Action extends string,
  TableName extends keyof DrizzleQueryFunction<DB>,
> = Map<
  Action,
  | QueryFilter<
      DB,
      TableName,
      DrizzleQueryFunctionInput<DB, TableName>,
      UserContext
    >[]
  | "unrestricted"
>;

export function isDynamicQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
>(
  filter: QueryFilter<DB, Table, Filter, Context>,
): filter is DynamicQueryFilter<DB, Table, Filter, Context> {
  return typeof filter === "function";
}

export function isStaticQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
>(
  filter: QueryFilter<DB, Table, Filter, Context>,
): filter is StaticQueryFilter<DB, Table, Filter> {
  return typeof filter !== "function";
}
