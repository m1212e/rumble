import type { AttributeValue } from "@opentelemetry/api";
import { mergeFilters } from "../helpers/mergeFilters";
import { createDistinctValuesFromSQLType } from "../helpers/sqlTypes/distinctValuesFromSQLType";
import { tableHelper } from "../helpers/tableHelpers";
import {
  ATTR_ABILITIES_DYNAMIC,
  ATTR_ABILITIES_STATIC,
  ATTR_ABILITIES_STATUS,
  ATTR_ABILITIES_TOTAL,
} from "../helpers/telemetry";
import type {
  DrizzleInstance,
  DrizzleQueryFunctionInput,
  TableRelationNames,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";
import { createColumnAccessResolver } from "./columnMask";
import { createFilterResponder } from "./filterResponse";
import { resolvedFilterKey } from "./keys";
import {
  type DynamicQueryFilter,
  isDynamicQueryFilter,
  isStaticQueryFilter,
  type QueryFilterRegistry,
  type StaticQueryFilter,
} from "./queryFilter";
import { traceAbilityPreparation } from "./telemetry";
import type { AbilitySettings, TableSchema } from "./types";

/**
 * filter() is async. Without type checking (plain JS, `any`) a forgotten await would
 * hand the promise itself to drizzle
 */
function guardAgainstMissingAwait<T>(promise: Promise<T>): Promise<T> {
  for (const key of ["query", "sql", "merge"]) {
    Object.defineProperty(promise, key, {
      enumerable: true,
      get() {
        throw new RumbleError(
          `Tried to access "${key}" on the result of abilities.<table>.filter(...) which is a Promise. filter() is async, did you forget to await it?`,
        );
      },
    });
  }
  return promise;
}

/**
 * A filter no row can match, since it requires the primary key to equal two
 * distinct values at once.
 */
function createBlockEverythingFilter(
  tableName: string,
  tableSchema: TableSchema,
) {
  if (Object.keys(tableSchema.primaryKey).length === 0) {
    throw new RumbleError(`No primary key found for entity ${tableName}`);
  }

  const primaryKeyField: any = Object.values(tableSchema.primaryKey)[0];
  const distinctValues = createDistinctValuesFromSQLType(
    primaryKeyField.getSQLType() as any,
  );

  return {
    where: {
      AND: [
        {
          [primaryKeyField.name]: distinctValues.value1,
        },
        {
          [primaryKeyField.name]: distinctValues.value2,
        },
      ],
    },
  };
}

/**
 * Creates the abilities of a single table, which resolve the registered
 * query filters for a request.
 */
export const createTableAbilities = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  Action extends string,
  TableName extends TableRelationNames<DB>,
>(
  settings: AbilitySettings<DB, Action>,
  tableName: TableName,
  queryFilters: QueryFilterRegistry<UserContext, DB, Action, TableName>,
) => {
  const { db, actions } = settings;

  const simpleQueryFilters = Object.fromEntries(
    actions.map((action) => {
      const filters = queryFilters.get(action);

      if (!filters || filters === "unrestricted") return [action, []];

      return [action, filters.filter(isStaticQueryFilter)];
    }),
  ) as {
    [key in Action]: StaticQueryFilter<
      DB,
      TableName,
      DrizzleQueryFunctionInput<DB, TableName>
    >[];
  };

  const dynamicQueryFilters = Object.fromEntries(
    actions.map((action) => {
      const filters = queryFilters.get(action);

      if (!filters || filters === "unrestricted") return [action, []];

      return [action, filters.filter(isDynamicQueryFilter)];
    }),
  ) as {
    [key in Action]: DynamicQueryFilter<
      DB,
      TableName,
      DrizzleQueryFunctionInput<DB, TableName>,
      UserContext
    >[];
  };

  const tableSchema = tableHelper({
    db,
    table: tableName,
  });

  // we want a filter that excludes everything
  const blockEverythingFilter = createBlockEverythingFilter(
    String(tableName),
    tableSchema,
  );
  const resolveColumnAccess = createColumnAccessResolver(
    settings,
    tableName,
    tableSchema,
  );
  const transformToResponse = createFilterResponder<DB, TableName>(
    settings,
    tableSchema,
  );

  const assembleAbilities = async (
    userContext: UserContext,
    action: Action,
    attributes: Record<string, AttributeValue>,
  ) => {
    const filters = queryFilters.get(action);

    // in case we have a wildcard ability, skip the rest and return no filters at all
    if (filters === "unrestricted") {
      attributes[ATTR_ABILITIES_STATUS] = "unrestricted";
      return transformToResponse();
    }

    // if nothing has been allowed, block everything
    if (!filters) {
      attributes[ATTR_ABILITIES_STATUS] = "blocked_everything";
      settings.warnNothingRegistered(String(tableName), action);
      return transformToResponse(blockEverythingFilter);
    }

    // run all dynamic filters, they may be async so we start all of them first
    const rawResults = await Promise.all(
      dynamicQueryFilters[action].map((func) => func(userContext)),
    );

    // if one of the dynamic filters returns "allow", we want to allow everything
    if (rawResults.includes("allow")) {
      attributes[ATTR_ABILITIES_STATUS] = "unrestricted";
      return transformToResponse();
    }

    // if nothing is returned, nothing is allowed by this filter
    const dynamicResults = rawResults.filter(
      (r): r is Exclude<typeof r, undefined | "allow"> => r !== undefined,
    ) as DrizzleQueryFunctionInput<DB, TableName>[];

    attributes[ATTR_ABILITIES_DYNAMIC] = dynamicResults.length;
    attributes[ATTR_ABILITIES_STATIC] = simpleQueryFilters[action].length;

    const allQueryFilters = [...simpleQueryFilters[action], ...dynamicResults];

    attributes[ATTR_ABILITIES_TOTAL] = allQueryFilters.length;

    // if we don't have any permitted filters then block everything
    if (allQueryFilters.length === 0) {
      attributes[ATTR_ABILITIES_STATUS] = "blocked_everything";

      return transformToResponse(blockEverythingFilter);
    }

    const mergedFilters = (
      allQueryFilters.length === 1
        ? { ...allQueryFilters[0] }
        : allQueryFilters.reduce((a, b) => {
            return mergeFilters(a, b, "OR");
          })
    ) as Record<string, any>;

    const { columns, extras, mask } = resolveColumnAccess(
      action,
      allQueryFilters,
    );
    if (columns) {
      mergedFilters.columns = columns;
    } else {
      delete mergedFilters.columns;
    }
    if (extras) {
      mergedFilters.extras = {
        ...mergedFilters.extras,
        ...extras,
      };
    }

    attributes[ATTR_ABILITIES_STATUS] = "applied";
    return transformToResponse(mergedFilters as any, mask);
  };

  return {
    withContext: (userContext: UserContext) => {
      const prepare = (action: Action) =>
        traceAbilityPreparation(
          settings,
          String(tableName),
          action,
          (attributes) => assembleAbilities(userContext, action, attributes),
        );

      // abilities are resolved once per request and action, since
      // filter() is called by every field and the (possibly async)
      // callbacks may be expensive, e.g. calling an external service
      const cache = new Map<Action, ReturnType<typeof prepare>>();
      const resolved = new Map<Action, Awaited<ReturnType<typeof prepare>>>();

      const abilities = {
        filter: (action: Action) => {
          let prepared = cache.get(action);
          if (!prepared) {
            prepared = guardAgainstMissingAwait(prepare(action));
            cache.set(action, prepared);
            prepared.then(
              (result) => resolved.set(action, result),
              () => {},
            );
          }
          return prepared;
        },
      };
      // kept out of the type: declaration emit can't name the internal key
      (abilities as any)[resolvedFilterKey] = (action: Action) =>
        resolved.get(action);
      return abilities;
    },
  };
};
