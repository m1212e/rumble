import type {
  Filter,
  FilterPrefetchCombo,
  Prefetch,
} from "../runtimeFiltersPlugin/filterTypes";
import type {
  DrizzleInstance,
  DrizzleQueryFunctionInput,
  DrizzleTableValueType,
  TableRelationNames,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";
import type { QueryFilter, QueryFilterRegistry } from "./queryFilter";

/**
 * Creates the registration API (allow/filter) of a single table.
 */
export const createTableBuilder = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  Action extends string,
  TableName extends TableRelationNames<DB>,
>({
  actions,
  isBuilt,
}: {
  actions: Action[];
  isBuilt: () => boolean;
}) => {
  const queryFilters: QueryFilterRegistry<UserContext, DB, Action, TableName> =
    new Map();

  const runtimeFilters = new Map<
    Action,
    //TODO add a run all helper
    FilterPrefetchCombo<UserContext, any, any>[]
  >();

  // we want to init all possible runtime filters since we want to ensure
  // that the implementaiton helpers pass an object by reference when creating
  // the implementation, instead of a copy like it would be the case with undefined
  for (const action of actions) {
    if (!runtimeFilters.has(action)) {
      runtimeFilters.set(action, []);
    }
  }

  // prefetch() is an optional step before by(), so both paths end in the
  // same registration, with the prefetched type flowing into the filter
  const registerFilter = <PrefetchReturnType = never>(
    actions: Action[],
    prefetch?: Prefetch<UserContext, PrefetchReturnType>,
  ) => ({
    /**
     * The actual filter function to apply. Returns the allowed values
     */
    by: (
      explicitFilter: Filter<
        UserContext,
        DrizzleTableValueType<DB, TableName>,
        PrefetchReturnType
      >,
    ) => {
      for (const action of actions) {
        // we initialized all possible actions when creating the builder
        runtimeFilters
          .get(action)!
          .push(
            prefetch
              ? { filter: explicitFilter, prefetch }
              : { filter: explicitFilter },
          );
      }
    },
  });

  return {
    /**
     * Allows to perform a specific action on a specific entity
     */
    allow: (action: Action | Action[]) => {
      if (isBuilt()) {
        throw new RumbleError(
          "You can't call allow() after the ability builder has been built. Please ensure that you register all abilities before accessing them.",
        );
      }

      const actions = Array.isArray(action) ? action : [action];
      // Track which actions this specific allow() call initialized as "unrestricted",
      // so .when() can distinguish chained use (allow().when()) from a later separate call
      // that finds a pre-existing "unrestricted" from a prior bare allow().
      const setUnrestrictedByThisCall = new Set<(typeof actions)[number]>();
      for (const action of actions) {
        let filters = queryFilters.get(action);
        if (!filters) {
          filters = "unrestricted";
          queryFilters.set(action, filters);
          setUnrestrictedByThisCall.add(action);
        }
      }

      return {
        /**
         * Restricts the allowed actions to a filter
         * @example
         * ```ts
         * abilityBuilder.users.allow(["read", "update", "delete"]).when(({ userId }) => ({
         *    where: {
         *      id: userId,
         *    },
         *  }));
         * ```
         */
        when: (
          queryFilter: QueryFilter<
            DB,
            TableName,
            DrizzleQueryFunctionInput<DB, TableName>,
            UserContext
          >,
        ) => {
          for (const action of actions) {
            if (queryFilters.get(action) === "unrestricted") {
              if (setUnrestrictedByThisCall.has(action)) {
                // Chained directly on this allow() call — override unrestricted with specific filter
                queryFilters.set(action, []);
              } else {
                // A previous separate bare allow() already set unrestricted
                //  skip this filter
                continue;
              }
            }
            const filters = queryFilters.get(action)!;
            (filters as Exclude<typeof filters, "unrestricted">).push(
              queryFilter,
            );
          }
        },
      };
    },
    /**
     * Allows to register an application level filter to restrict some results
     * which were returned by a query
     */
    filter: (action: Action | Action[]) => {
      const actions = Array.isArray(action) ? action : [action];
      return {
        /**
         * Allows to register an application level prefetch to fetch some data
         * which could be useful for later filtering the results. The prefetch
         * function will be called with the user context but unlike the actual
         * filter function, it will not have access to the result of the query
         * and therefore can be run in parallel with underlying query resolver.
         * A typical use case is to fetch some data which is not directly
         * related to the query but to the context only. So e.g. fetching the
         * user's permissions from an external system and then later applying
         * the filter based on those permissions.
         */
        prefetch: <PrefetchReturnType>(
          prefetch: Prefetch<UserContext, PrefetchReturnType>,
        ) => registerFilter<PrefetchReturnType>(actions, prefetch),
        ...registerFilter(actions),
      };
    },
    _: {
      runtimeFilters,
      queryFilters,
    },
  };
};
