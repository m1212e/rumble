import { toMerged } from "es-toolkit";

// See the comment on `EmptyFilter` in `../abilityBuilder.ts` for why this is
// recreated locally instead of imported from drizzle-orm.
const EmptyFilter = Symbol.for("drizzle:EmptyFilter");

/**
 * Normalizes drizzle-orm's `EmptyFilter` sentinel to `undefined` so it's
 * treated as "no filter" rather than a real filter value to combine with
 * AND/OR — otherwise merging an unrestricted (EmptyFilter) base filter with
 * a real `where` would needlessly wrap it as `{ AND: [EmptyFilter, where] }`
 * instead of just `where`.
 */
function realWhere(where: unknown) {
  return where === EmptyFilter ? undefined : where;
}

export function mergeFilters<
  FilterA extends Record<string, any>,
  FilterB extends Record<string, any>,
>(
  filterA?: Partial<FilterA>,
  filterB?: Partial<FilterB>,
  mode: "AND" | "OR" = "AND",
) {
  const filterAWhere = realWhere(filterA?.where);
  const filterBWhere = realWhere(filterB?.where);

  const where =
    filterAWhere && filterBWhere
      ? mode === "OR"
        ? { OR: [filterAWhere, filterBWhere] }
        : { AND: [filterAWhere, filterBWhere] }
      : (filterAWhere ?? filterBWhere);

  const columns =
    filterA?.columns || filterB?.columns
      ? new Set(
          [
            Object.entries(filterA?.columns ?? {}),
            Object.entries(filterB?.columns ?? {}),
          ]
            .flat()
            .filter(([, v]) => v === true)
            .map(([k]) => k),
        )
          .entries()
          .reduce(
            (acc, [key]) => {
              acc[key] = true;
              return acc;
            },
            {} as Record<string, true>,
          )
      : undefined;

  const extras =
    filterA?.extras || filterB?.extras
      ? toMerged(filterA?.extras ?? {}, filterB?.extras ?? {})
      : undefined;

  const orderBy =
    filterA?.orderBy || filterB?.orderBy
      ? toMerged(filterA?.orderBy ?? {}, filterB?.orderBy ?? {})
      : undefined;

  const limit =
    mode === "OR"
      ? filterA?.limit === undefined || filterB?.limit === undefined
        ? undefined
        : Math.max(filterA.limit, filterB.limit)
      : filterA?.limit || filterB?.limit
        ? Math.min(filterA?.limit ?? Infinity, filterB?.limit ?? Infinity)
        : undefined;

  const offset =
    mode === "OR"
      ? filterA?.offset === undefined || filterB?.offset === undefined
        ? undefined
        : Math.min(filterA.offset, filterB.offset)
      : filterA?.offset || filterB?.offset
        ? Math.min(filterA?.offset ?? Infinity, filterB?.offset ?? Infinity)
        : undefined;

  const with_ =
    filterA?.with || filterB?.with
      ? toMerged(filterA?.with ?? {}, filterB?.with ?? {})
      : undefined;

  return {
    where,
    columns,
    extras,
    orderBy,
    limit,
    offset,
    with: with_,
  } as unknown as FilterA & FilterB;
}
