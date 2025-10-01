import { merge } from "es-toolkit";

export function mergeFilters<Filter>(...filters: Partial<Filter>[]) {
  const allWhereClauses = filters
    .map((f) => (f as any).where)
    .filter((w) => w !== undefined && w !== null);

  const uniqueColumns = new Set(
    filters.flatMap((f) =>
      (f as any).columns ? Object.keys((f as any).columns) : [],
    ),
  );
  const mappedUniqueColumns =
    uniqueColumns.size > 0
      ? uniqueColumns.values().reduce((prev, curr) => {
          prev[curr] = true;
          return prev;
        }, {} as any)
      : undefined;

  const mergedExtras = {};
  let touchedExtras = false;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    if ((filter as any).extras) {
      merge(mergedExtras, (filter as any).extras);
      touchedExtras = true;
    }
  }

  const mergedOrderBy = {};
  let touchedOrderBy = false;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    if ((filter as any).orderBy) {
      merge(mergedOrderBy, (filter as any).orderBy);
      touchedOrderBy = true;
    }
  }

  const lowestLimit: number = Math.min(
    ...filters.map((f) => (f as any).limit ?? Infinity),
  );
  const lowestOffset: number = Math.min(
    ...filters.map((f) => (f as any).offset ?? Infinity),
  );

  const mergedWith = {};
  let touchedWith = false;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    if ((filter as any).with) {
      merge(mergedWith, (filter as any).with);
      touchedWith = true;
    }
  }

  return {
    where:
      allWhereClauses.length > 0
        ? ({ AND: allWhereClauses } as any)
        : undefined,
    columns: mappedUniqueColumns,
    extras: touchedExtras ? mergedExtras : undefined,
    orderBy: touchedOrderBy ? mergedOrderBy : undefined,
    limit: lowestLimit < Infinity ? lowestLimit : undefined,
    offset: lowestOffset < Infinity ? lowestOffset : undefined,
    with: touchedWith ? mergedWith : undefined,
  } as Filter;
}
