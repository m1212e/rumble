import type { AttributeValue } from "@opentelemetry/api";
import { mergeFilters, realWhere } from "../helpers/mergeFilters";
import { relationsFilterToSQL } from "../helpers/relationsFilterToSQL";
import { sanitizeFilterValue } from "../helpers/sanitizeFilterValue";
import { createDistinctValuesFromSQLType } from "../helpers/sqlTypes/distinctValuesFromSQLType";
import { tableHelper } from "../helpers/tableHelpers";
import {
  ATTR_ABILITIES_DYNAMIC,
  ATTR_ABILITIES_RESOLVED,
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
import { refreshAbilitiesKey, resolvedFilterKey } from "./keys";
import {
  type DynamicQueryFilter,
  isDynamicQueryFilter,
  isStaticQueryFilter,
  type QueryFilterRegistry,
  type StaticQueryFilter,
} from "./queryFilter";
import { createRuleResolver } from "./resolveRules";
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
export function createBlockEverythingFilter(
  tableName: string,
  tableSchema: TableSchema,
) {
  if (Object.keys(tableSchema.primaryKey).length === 0) {
    throw new RumbleError(`No primary key found for entity ${tableName}`);
  }

  // relational where keys are ts names, not database names
  const [primaryKeyName, primaryKeyField] = Object.entries(
    tableSchema.primaryKey,
  )[0] as [string, any];
  const distinctValues = createDistinctValuesFromSQLType(
    primaryKeyField.getSQLType() as any,
  );

  return {
    where: {
      AND: [
        {
          [primaryKeyName]: distinctValues.value1,
        },
        {
          [primaryKeyName]: distinctValues.value2,
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

  const tableSchema = tableHelper({
    db,
    table: tableName,
  });

  // A where compiling to no sql (e.g. `{ id: undefined }`) restricts nothing,
  // so its ability applies to every row. Dropped here, the row filter and the
  // column mask both treat it as such.
  const withRestrictingWhere = <Filter>(filter: Filter): Filter => {
    const where = realWhere((filter as { where?: unknown }).where);
    const restricts =
      !!where &&
      Object.keys(where).length > 0 &&
      relationsFilterToSQL(
        tableSchema.table,
        sanitizeFilterValue(where) as any,
        tableSchema.relations,
        db._.relations,
      ) !== undefined;
    return restricts || where === undefined
      ? filter
      : { ...filter, where: undefined };
  };

  // static filters are known upfront, so they are only checked once
  const simpleQueryFilters = Object.fromEntries(
    actions.map((action) => {
      const filters = queryFilters.get(action);

      if (!filters || filters === "unrestricted") return [action, []];

      return [
        action,
        filters.filter(isStaticQueryFilter).map(withRestrictingWhere),
      ];
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

  type DynamicResults = (
    | StaticQueryFilter<DB, TableName, DrizzleQueryFunctionInput<DB, TableName>>
    | undefined
    | "allow"
  )[];

  // we want a filter that excludes everything
  const blockEverythingFilter = createBlockEverythingFilter(
    String(tableName),
    tableSchema,
  );
  const resolveColumnAccess = createColumnAccessResolver<DB, Action, TableName>(
    settings,
    tableSchema,
  );
  const transformToResponse = createFilterResponder<DB, TableName>(
    settings,
    tableSchema,
  );
  const resolveRules = createRuleResolver(settings, tableSchema);

  // the dynamic filters may be async, so they all start at once
  const evaluateDynamicFilters = (
    userContext: UserContext,
    action: Action,
  ): Promise<DynamicResults> =>
    Promise.all(dynamicQueryFilters[action].map((func) => func(userContext)));

  /** The response for the rules applying to the caller: their OR, columns and flags. */
  const respondWithFilters = (
    action: Action,
    allQueryFilters: DrizzleQueryFunctionInput<DB, TableName>[],
  ) => {
    const mergedFilters = (
      allQueryFilters.length === 1
        ? { ...allQueryFilters[0] }
        : allQueryFilters.reduce((a, b) => {
            return mergeFilters(a, b, "OR");
          })
    ) as Record<string, any>;

    const { columns, extras, mask, visibility } = resolveColumnAccess(
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

    return transformToResponse(mergedFilters as any, mask, visibility);
  };

  const assembleAbilities = async (
    action: Action,
    attributes: Record<string, AttributeValue>,
    evaluate: () => Promise<DynamicResults>,
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

    const rawResults = await evaluate();

    // if one of the dynamic filters returns "allow", we want to allow everything
    if (rawResults.includes("allow")) {
      attributes[ATTR_ABILITIES_STATUS] = "unrestricted";
      return transformToResponse();
    }

    // if nothing is returned, nothing is allowed by this filter
    const dynamicResults = (
      rawResults.filter(
        (r): r is Exclude<typeof r, undefined | "allow"> => r !== undefined,
      ) as DrizzleQueryFunctionInput<DB, TableName>[]
    ).map(withRestrictingWhere);

    attributes[ATTR_ABILITIES_DYNAMIC] = dynamicResults.length;
    attributes[ATTR_ABILITIES_STATIC] = simpleQueryFilters[action].length;

    let allQueryFilters = [...simpleQueryFilters[action], ...dynamicResults];

    attributes[ATTR_ABILITIES_TOTAL] = allQueryFilters.length;

    if (resolveRules && allQueryFilters.length > 0) {
      const resolution = await resolveRules(allQueryFilters);
      allQueryFilters = resolution.filters;
      attributes[ATTR_ABILITIES_RESOLVED] = resolution.resolved;
    }

    // if we don't have any permitted filters then block everything
    if (allQueryFilters.length === 0) {
      attributes[ATTR_ABILITIES_STATUS] = "blocked_everything";

      return transformToResponse(blockEverythingFilter);
    }

    attributes[ATTR_ABILITIES_STATUS] = "applied";
    return respondWithFilters(action, allQueryFilters);
  };

  return {
    withContext: (userContext: UserContext) => {
      // the (possibly async) callbacks may be expensive, e.g. calling an
      // external service, so they run once per snapshot and action
      const evaluated = new Map<
        Action,
        { results: Promise<DynamicResults>; settled: boolean }
      >();
      const evaluate = (action: Action) => {
        let entry = evaluated.get(action);
        if (!entry) {
          const results = evaluateDynamicFilters(userContext, action);
          const started = { results, settled: false };
          const settle = () => {
            started.settled = true;
          };
          results.then(settle, settle);
          evaluated.set(action, started);
          entry = started;
        }
        return entry.results;
      };

      const prepare = (action: Action) =>
        traceAbilityPreparation(
          settings,
          String(tableName),
          action,
          (attributes) =>
            assembleAbilities(action, attributes, () => evaluate(action)),
        );

      // abilities are resolved once per request and action, since
      // filter() is called by every field
      let cache = new Map<Action, ReturnType<typeof prepare>>();
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
      // The evaluated callbacks and the resolved primary keys are a snapshot.
      // Every root field starting to resolve (a mutation after another, a
      // subscription event, a live query refetching) takes a new one, so an
      // async callback loading ids sees what changed since, just as rows
      // related to the caller since then show up. A callback still running is
      // kept: it started in this tick, e.g. for a sibling root field of the
      // same query, which runs in parallel and shares it.
      (abilities as any)[refreshAbilitiesKey] = () => {
        for (const [action, entry] of evaluated) {
          if (!entry.settled) continue;
          evaluated.delete(action);
          cache.delete(action);
        }
        if (resolveRules) cache = new Map();
      };
      return abilities;
    },
  };
};
