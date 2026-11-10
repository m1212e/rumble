import { describe, expect, test } from "bun:test";
import { parseValue as parseGraphQLValue } from "graphql";
import { SearchResolver } from "../../lib/scalars/search";

describe("SearchResolver", () => {
  test("a string is the term alone", () => {
    expect(SearchResolver.parseValue("alice")).toEqual({ search: "alice" });
  });

  test("an object carries the term and the columns", () => {
    expect(
      SearchResolver.parseValue({ search: "alice", columns: ["name"] }),
    ).toEqual({ search: "alice", columns: ["name"] });
  });

  test("an object without columns is the term alone", () => {
    expect(SearchResolver.parseValue({ search: "alice" })).toEqual({
      search: "alice",
    });
    expect(
      SearchResolver.parseValue({ search: "alice", columns: null }),
    ).toEqual({ search: "alice" });
  });

  test("anything else is refused", () => {
    expect(() => SearchResolver.parseValue(3)).toThrow();
    expect(() => SearchResolver.parseValue(null)).toThrow();
    expect(() => SearchResolver.parseValue(["alice"])).toThrow();
    expect(() => SearchResolver.parseValue({ columns: ["name"] })).toThrow(
      /search term/,
    );
    expect(() =>
      SearchResolver.parseValue({ search: "alice", columns: "name" }),
    ).toThrow(/list of strings/);
    expect(() =>
      SearchResolver.parseValue({ search: "alice", columns: [1] }),
    ).toThrow(/list of strings/);
    expect(() =>
      SearchResolver.parseValue({ search: "alice", cols: ["name"] }),
    ).toThrow(/unknown keys cols/);
  });

  test("parses string and object literals", () => {
    const parseLiteral = (literal: string) =>
      SearchResolver.parseLiteral(parseGraphQLValue(literal), undefined);

    expect(parseLiteral('"alice"')).toEqual({ search: "alice" });
    expect(
      parseLiteral('{ search: "alice", columns: ["name", "email"] }'),
    ).toEqual({ search: "alice", columns: ["name", "email"] });
    expect(() => parseLiteral("3")).toThrow();
  });
});
