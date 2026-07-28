import { describe, expect, test } from "bun:test";
import { sanitizeFilterValue } from "../../lib/helpers/sanitizeFilterValue";

// See the comment on `EmptyFilter` in `../../lib/helpers/sanitizeFilterValue.ts`
// — it's a globally registered symbol, so recreating it here yields the same value.
const EmptyFilter = Symbol.for("drizzle:EmptyFilter");

describe("sanitizeFilterValue", () => {
  test("replaces a top-level undefined with EmptyFilter", () => {
    expect(sanitizeFilterValue(undefined)).toBe(EmptyFilter);
  });

  test("leaves EmptyFilter itself untouched", () => {
    expect(sanitizeFilterValue(EmptyFilter)).toBe(EmptyFilter);
  });

  test("leaves null untouched (a real IS NULL condition, not a skip)", () => {
    expect(sanitizeFilterValue(null)).toBeNull();
  });

  test("leaves a filter with no undefineds unchanged in shape", () => {
    const filter = { ownerId: "user-1", published: true };
    expect(sanitizeFilterValue(filter)).toEqual(filter);
  });

  test("replaces undefined nested inside an AND array element", () => {
    const cond = false;
    const filter = {
      AND: [{ ownerId: "user-1" }, cond ? { published: true } : undefined],
    };
    expect(sanitizeFilterValue(filter)).toEqual({
      AND: [{ ownerId: "user-1" }, EmptyFilter],
    });
  });

  test("replaces undefined nested inside an OR array element", () => {
    const filter = { OR: [{ ownerId: "user-1" }, undefined] };
    expect(sanitizeFilterValue(filter)).toEqual({
      OR: [{ ownerId: "user-1" }, EmptyFilter],
    });
  });

  test("replaces undefined used as a column operator value", () => {
    const filter = { name: { eq: undefined, ne: "bob" } };
    expect(sanitizeFilterValue(filter)).toEqual({
      name: { eq: EmptyFilter, ne: "bob" },
    });
  });

  test("replaces undefined nested inside a relation sub-filter", () => {
    const filter = { author: { name: { eq: undefined } } };
    expect(sanitizeFilterValue(filter)).toEqual({
      author: { name: { eq: EmptyFilter } },
    });
  });

  test("does not descend into a Date value", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const filter = { createdAt: { gte: date } };
    const result = sanitizeFilterValue(filter) as any;
    expect(result.createdAt.gte).toBe(date);
  });

  test("does not descend into a RAW callback function", () => {
    const raw = (table: unknown) => table;
    const filter = { RAW: raw };
    const result = sanitizeFilterValue(filter) as any;
    expect(result.RAW).toBe(raw);
  });
});
