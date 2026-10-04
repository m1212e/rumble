import { toMerged } from "es-toolkit";

// See the comment on `EmptyFilter` in `./sanitizeFilterValue.ts` for why this
// is recreated locally instead of imported from drizzle-orm.
const EmptyFilter = Symbol.for("drizzle:EmptyFilter");

/**
 * Normalizes drizzle-orm's `EmptyFilter` sentinel to `undefined` so it's
 * treated as "no filter" rather than a real filter value to combine with
 * AND/OR — otherwise merging an unrestricted (EmptyFilter) base filter with
 * a real `where` would needlessly wrap it as `{ AND: [EmptyFilter, where] }`
 * instead of just `where`.
 */
export function realWhere(where: unknown) {
  return where === EmptyFilter ? undefined : where;
}

type Mode = "AND" | "OR";

function mergeWhere(a: unknown, b: unknown, mode: Mode) {
  if (a && b) {
    return mode === "OR" ? { OR: [a, b] } : { AND: [a, b] };
  }
  // an OR with a missing side would widen to "everything", so no where at all
  return mode === "OR" ? undefined : (a ?? b);
}

function mergeColumns(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>,
) {
  if (!a && !b) return undefined;
  const result: Record<string, true> = {};
  for (const [key, value] of [
    ...Object.entries(a ?? {}),
    ...Object.entries(b ?? {}),
  ]) {
    if (value === true) result[key] = true;
  }
  return result;
}

function mergeRecords(a?: Record<string, any>, b?: Record<string, any>) {
  return a || b ? toMerged(a ?? {}, b ?? {}) : undefined;
}

/**
 * Combines two limit/offset style bounds. For OR the looser bound wins (and a
 * missing side means unbounded), for AND the stricter bound wins.
 */
function mergeBound(
  a: number | undefined,
  b: number | undefined,
  mode: Mode,
  orPick: (a: number, b: number) => number,
) {
  if (mode === "OR") {
    return a === undefined || b === undefined ? undefined : orPick(a, b);
  }
  return a || b ? Math.min(a ?? Infinity, b ?? Infinity) : undefined;
}

export function mergeFilters<
  FilterA extends Record<string, any>,
  FilterB extends Record<string, any>,
>(filterA?: Partial<FilterA>, filterB?: Partial<FilterB>, mode: Mode = "AND") {
  return {
    where: mergeWhere(
      realWhere(filterA?.where),
      realWhere(filterB?.where),
      mode,
    ),
    columns: mergeColumns(filterA?.columns, filterB?.columns),
    extras: mergeRecords(filterA?.extras, filterB?.extras),
    orderBy: mergeRecords(filterA?.orderBy, filterB?.orderBy),
    limit: mergeBound(filterA?.limit, filterB?.limit, mode, Math.max),
    offset: mergeBound(filterA?.offset, filterB?.offset, mode, Math.min),
    with: mergeRecords(filterA?.with, filterB?.with),
  } as unknown as FilterA & FilterB;
}
