import { toMerged } from "es-toolkit";

export function mergeFilters<
  FilterA extends Record<string, any>,
  FilterB extends Record<string, any>,
>(filterA?: Partial<FilterA>, filterB?: Partial<FilterB>) {
  const where =
    filterA?.where && filterB?.where
      ? { AND: [filterA?.where, filterB?.where] }
      : (filterA?.where ?? filterB?.where);

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
    filterA?.limit || filterB?.limit
      ? Math.min(filterA?.limit ?? Infinity, filterB?.limit ?? Infinity)
      : undefined;

  const offset =
    filterA?.offset || filterB?.offset
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
