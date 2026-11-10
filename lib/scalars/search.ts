import { GraphQLScalarType, Kind, valueFromASTUntyped } from "graphql";
import { RumbleErrorSafe } from "../types/rumbleError";

/**
 * A search as the `search` argument takes it: the term, and optionally the
 * columns the client wants it to look at. The server only ever searches the
 * columns it allows; `columns` can narrow them, never widen them.
 */
export type SearchInput = {
  search: string;
  columns?: string[];
};

/**
 * Normalizes the `search` argument: a plain string searches what the server
 * selected, `{ search, columns }` narrows that to the named columns.
 *
 * @throws RumbleErrorSafe if the value has neither shape
 */
export const normalizeSearch = (value: unknown): SearchInput => {
  if (typeof value === "string") return { search: value };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RumbleErrorSafe(
      "Search must be a string or an object { search, columns }.",
    );
  }

  const { search, columns, ...rest } = value as Record<string, unknown>;
  const unknownKeys = Object.keys(rest);
  if (unknownKeys.length > 0) {
    throw new RumbleErrorSafe(
      `Search got unknown keys ${unknownKeys.join(", ")}, it takes only search and columns.`,
    );
  }
  if (typeof search !== "string") {
    throw new RumbleErrorSafe("Search needs the search term as a string.");
  }
  if (columns === undefined || columns === null) return { search };
  if (
    !Array.isArray(columns) ||
    !columns.every((column) => typeof column === "string")
  ) {
    throw new RumbleErrorSafe("Search columns must be a list of strings.");
  }
  return { search, columns: [...columns] };
};

export const SearchResolver = new GraphQLScalarType<SearchInput, never>({
  name: "Search",
  description:
    'A search term, or an object { search, columns } narrowing the search to some of the columns the server searches. Columns the server does not search are ignored, so "columns" can only narrow the search, never widen it.',
  serialize() {
    throw new RumbleErrorSafe("Search is an input only scalar.");
  },
  parseValue: normalizeSearch,
  parseLiteral(ast, variables) {
    if (ast.kind === Kind.STRING) return { search: ast.value };
    if (ast.kind === Kind.OBJECT) {
      return normalizeSearch(valueFromASTUntyped(ast, variables));
    }
    throw new RumbleErrorSafe(
      `Search must be a string or an object { search, columns } but got a: ${ast.kind}`,
    );
  },
});
