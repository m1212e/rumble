import type { Filter } from "../runtimeFiltersPlugin/filterTypes";

/**
 * A helper to apply a list of filters to a given list of entities.
 * 
 * @example
 * 
 * ```ts
 * const filtered = await applyFilters({
    filters: abilityBuilder.registeredFilters.posts.update,
    entities: entitiesToFilter,
    context: ctx,
  });
 * ```
 */
export const applyFilters = async <Context, T, H extends T>({
  filters,
  entities,
  context,
}: {
  entities: T[];
  filters: Filter<Context, H>[];
  context: Context;
}) => {
  return Array.from(
    (
      await Promise.all(
        filters.map((f) =>
          f({
            context,
            entities: entities as H[],
          }),
        ),
      )
    ).reduce((acc, val) => {
      for (const element of val) {
        acc.add(element);
      }
      return acc;
      // since multiple helpers might return the same entity we use a set to deduplicate
    }, new Set<T>()),
  );
};
