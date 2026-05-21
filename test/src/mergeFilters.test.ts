import { describe, expect, test } from "bun:test";
import { mergeFilters } from "../../lib/helpers/mergeFilters";

describe("mergeFilters", () => {
  describe("AND mode (default)", () => {
    test("combines two where clauses with AND", () => {
      const result = mergeFilters(
        { where: { published: true } },
        { where: { ownerId: "user-1" } },
      );
      expect((result as any).where).toEqual({
        AND: [{ published: true }, { ownerId: "user-1" }],
      });
    });

    test("takes minimum of two limits", () => {
      const result = mergeFilters({ limit: 10 }, { limit: 20 });
      expect(result.limit).toBe(10);
    });

    test("takes minimum of two offsets", () => {
      const result = mergeFilters({ offset: 5 }, { offset: 10 });
      expect(result.offset).toBe(5);
    });

    test("passes through single where clause when other is absent", () => {
      const result = mergeFilters({ where: { published: true } }, {});
      expect((result as any).where).toEqual({ published: true });
    });

    test("explicit AND mode behaves same as default", () => {
      const defaultResult = mergeFilters(
        { where: { a: 1 } },
        { where: { b: 2 } },
      );
      const explicitResult = mergeFilters(
        { where: { a: 1 } },
        { where: { b: 2 } },
        "AND",
      );
      expect((defaultResult as any).where).toEqual(
        (explicitResult as any).where,
      );
    });
  });

  describe("OR mode", () => {
    test("combines two where clauses with OR", () => {
      const result = mergeFilters(
        { where: { published: true } },
        { where: { published: false } },
        "OR",
      );
      expect((result as any).where).toEqual({
        OR: [{ published: true }, { published: false } as any],
      });
    });

    test("takes maximum of two limits", () => {
      const result = mergeFilters({ limit: 10 }, { limit: 20 }, "OR");
      expect(result.limit).toBe(20);
    });

    test("returns undefined limit when one filter has no limit", () => {
      const result = mergeFilters({ limit: 10 }, {}, "OR");
      expect(result.limit).toBeUndefined();
    });

    test("takes minimum of two offsets", () => {
      const result = mergeFilters({ offset: 5 }, { offset: 10 }, "OR");
      expect(result.offset).toBe(5);
    });

    test("returns undefined offset when one filter has no offset", () => {
      const result = mergeFilters({ offset: 5 }, {}, "OR");
      expect(result.offset).toBeUndefined();
    });

    test("passes through single where clause when other is absent", () => {
      const result = mergeFilters({ where: { published: true } }, {}, "OR");
      expect((result as any).where).toEqual({ published: true });
    });

    test("returns undefined where when both filters have no where", () => {
      const result = mergeFilters({}, {}, "OR");
      expect((result as any).where).toBeUndefined();
    });
  });

  describe("columns (both modes)", () => {
    test("unions columns marked true from both filters", () => {
      const result = mergeFilters(
        { columns: { id: true, firstName: false } },
        { columns: { id: false, lastName: true } },
      );
      expect(result.columns).toEqual({ id: true, lastName: true } as any);
    });

    test("returns undefined columns when neither filter has columns", () => {
      const result = mergeFilters({}, {});
      expect(result.columns).toBeUndefined();
    });
  });
});
