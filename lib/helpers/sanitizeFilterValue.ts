const EmptyFilter = Symbol.for("drizzle:EmptyFilter");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sanitizeFilterValue(value: unknown): unknown {
  if (value === undefined) return EmptyFilter;
  if (Array.isArray(value)) return value.map(sanitizeFilterValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeFilterValue(entry),
      ]),
    );
  }
  return value;
}
