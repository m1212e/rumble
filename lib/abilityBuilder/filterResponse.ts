import { relationsFilterToSQL, type SQL } from "drizzle-orm";
import { lazy } from "../helpers/lazy";
import { mergeFilters } from "../helpers/mergeFilters";
import { sanitizeFilterValue } from "../helpers/sanitizeFilterValue";
import type {
  DrizzleInstance,
  DrizzleQueryFunctionInput,
  TableRelationNames,
} from "../types/drizzleInstanceType";
import type { ColumnMask } from "./columnMask";
import { columnMaskKey } from "./keys";
import type { AbilitySettings, TableSchema } from "./types";

type FindFirstConfig<
  DB extends DrizzleInstance,
  TableName extends TableRelationNames<DB>,
> = NonNullable<Parameters<DB["query"][TableName]["findFirst"]>[0]>;

type FindManyConfig<
  DB extends DrizzleInstance,
  TableName extends TableRelationNames<DB>,
> = NonNullable<Parameters<DB["query"][TableName]["findMany"]>[0]>;

/**
 * The query filters of an ability, as handed out by
 * `abilities.<table>.filter(...)`.
 *
 * `columns` and `extras` are set at runtime but left out of the types on
 * purpose: a visible, loosely typed extras makes drizzle infer `{}` as the row
 * type of findFirst/findMany, and the column flag is an internal detail anyway.
 */
export type AbilityFilter<
  DB extends DrizzleInstance,
  TableName extends TableRelationNames<DB>,
> = {
  /**
   * Query filters for the drizzle query API.
   * @example
   * ```ts
   * author: t.relation("author", {
   *  query: async (_args, ctx) => (await ctx.abilities.users.filter("read")).query.single,
   * }),
   * ```
   */
  query: {
    /**
     * For find first calls
     */
    single: Pick<FindFirstConfig<DB, TableName>, "where">;
    /**
     * For find many calls
     */
    many: Pick<FindManyConfig<DB, TableName>, "where" | "limit">;
  };
  /**
   * Query filters for the drizzle SQL API as used in e.g. updates.
   * @example
   *
   * ```ts
   * await db
   *	.update(schema.users)
   *	.set({
   *	  name: args.newName,
   * 	})
   *	.where(
   *	  and(
   *	    eq(schema.users.id, args.userId),
   *	    (await ctx.abilities.users.filter("update")).sql.where,
   *	  ),
   *	);
   * ```
   *
   */
  sql: {
    readonly where: SQL | undefined;
  };
};

/**
 * What `abilities.<table>.filter(...)` resolves to.
 */
// exported so the bundled declarations name it instead of inlining it
// fallow-ignore-next-line unused-type
export type AbilityFilterResponse<
  DB extends DrizzleInstance,
  TableName extends TableRelationNames<DB>,
> = AbilityFilter<DB, TableName> & {
  /**
   * Merges the current query filters with the provided filters for this call only
   */
  merge: (
    filters: NonNullable<DrizzleQueryFunctionInput<DB, TableName>>,
  ) => AbilityFilter<DB, TableName>;
};

/**
 * The limit of a find many call. An injected merge limit wins unless the
 * ability limit is lower, otherwise the default limit caps the ability limit.
 */
function resolveLimit(
  abilityLimit: number | undefined | null,
  mergedLimit: number | undefined,
  defaultLimit: number | undefined | null,
) {
  if (
    mergedLimit !== undefined &&
    (!abilityLimit || abilityLimit > mergedLimit)
  ) {
    return mergedLimit;
  }

  if (
    defaultLimit &&
    (abilityLimit === undefined || (abilityLimit as number) > defaultLimit)
  ) {
    return defaultLimit;
  }

  // ensure that null is converted to undefined
  return abilityLimit ?? undefined;
}

/**
 * Creates the function packing resolved query filters into the object handed
 * out by `abilities.<table>.filter(...)`.
 */
export function createFilterResponder<
  DB extends DrizzleInstance,
  TableName extends TableRelationNames<DB>,
>({ db, defaultLimit }: AbilitySettings<DB, any>, tableSchema: TableSchema) {
  const internalTransformer = (
    filters?: DrizzleQueryFunctionInput<DB, TableName>,
    mergedLimit?: number,
  ): AbilityFilter<DB, TableName> => {
    const where = filters?.where;
    const extras = filters?.extras;
    const columns = filters?.columns;

    const limit = lazy(() =>
      resolveLimit(
        filters?.limit as number | undefined | null,
        mergedLimit,
        defaultLimit,
      ),
    );

    const sqlTransformedWhere = lazy(() => {
      const casing = (db._ as any).session?.dialect?.casing;

      return where
        ? relationsFilterToSQL(
            tableSchema.foundRelation.table,
            sanitizeFilterValue(where) as any,
            tableSchema.relations,
            db._.relations,
            casing,
          )
        : undefined;
    });

    // Two shapes since we do not want to use delete for performance reasons
    // and an undefined columns field on a drizzle filter will prevent any
    // column from being selected at all
    const single = columns
      ? { extras, where: sanitizeFilterValue(where), columns }
      : { extras, where: sanitizeFilterValue(where) };
    const many = columns
      ? {
          extras,
          where: sanitizeFilterValue(where),
          columns,
          get limit() {
            return limit();
          },
        }
      : {
          extras,
          where: sanitizeFilterValue(where),
          get limit() {
            return limit();
          },
        };

    return {
      query: { single, many },
      sql: {
        get where() {
          return sqlTransformedWhere();
        },
      },
    } as AbilityFilter<DB, TableName>;
  };

  /**
   * Packs the filters into a response object that can be applied for queries by the user
   */
  return function transformToResponse(
    queryFilters?: DrizzleQueryFunctionInput<DB, TableName>,
    columnMask?: ColumnMask,
  ) {
    const ret = internalTransformer(queryFilters) as AbilityFilterResponse<
      DB,
      TableName
    >;

    ret.merge = (filters) =>
      internalTransformer(
        mergeFilters(ret.query.many, filters),
        // in case the user wants to inject a limit, we need to ensure that it is applied
        // and not the potential default limit will be used
        // this is important for functions of the default query pagination implementation
        filters.limit as number | undefined,
      );
    (ret as any)[columnMaskKey] = columnMask;

    return ret;
  };
}
