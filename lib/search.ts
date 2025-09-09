import { sql } from "drizzle-orm";
import { cloneDeep } from "es-toolkit";
import { isPostgresDB } from "./helpers/determineDialectFromSchema";
import type { tableHelper } from "./helpers/tableHelpers";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";

export async function initSearchIfApplicable<
	DB extends GenericDrizzleDbTypeConstraints,
>(db: DB) {
	//TODO: make other dialects compatible
	if (!isPostgresDB(db)) {
		console.info(
			"Database dialect is not compatible with search, skipping search initialization.",
		);
		return;
	}

	await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
}

export function adjustQueryForSearch({
	search,
	args,
	tableSchema,
	abilities,
}: Pick<RumbleInput<any, any, any, any, any>, "search"> & {
	//TODO types
	args: any;
	tableSchema: ReturnType<typeof tableHelper>;
	//TODO types
	abilities: any;
}) {
	if (search?.enabled && args.search && args.search.length > 0) {
		const originalOrderBy = cloneDeep(args.orderBy);
		(args as any).orderBy = (table: any) => {
			const argsOrderBySQL = sql.join(
				Object.entries(originalOrderBy ?? {}).map(([key, value]) => {
					// value is "asc" or "desc"
					if (value === "asc") {
						return sql`${table[key]} ASC`;
					} else if (value === "desc") {
						return sql`${table[key]} DESC`;
					} else {
						throw new Error(`Invalid value ${value} for orderBy`);
					}
				}),
				sql.raw(", "),
			);

			// this prevents columns beeing searched which are not accessible to the user
			// if the abilities defined the user not to be allowed to read something, we need
			// to prevent it from beeing included in the search since this could
			// leak information
			const columnsToSearch = abilities.query.many.columns
				? Object.entries(tableSchema.columns).filter(
						([key]) => abilities.query.many.columns[key],
					)
				: Object.entries(tableSchema.columns);

			// GREATEST(similarity(name, ${query.search}), similarity(description, ${query.search})) DESC
			const searchSQL = sql`GREATEST(${sql.join(
				columnsToSearch.map(([key]) => {
					return sql`similarity(${table[key]}::TEXT, ${args.search})`;
				}),
				sql.raw(", "),
			)}) DESC`;

			const ret = originalOrderBy
				? sql.join([argsOrderBySQL, searchSQL], sql.raw(", "))
				: searchSQL;

			// const pgDialect = new PgDialect();
			// console.log(pgDialect.sqlToQuery(ret));

			return ret;
		};

		const originalWhere = cloneDeep(args.where);

		// this limits the search to the rows which at least match the threshold score
		(args as any).where = {
			AND: [
				originalWhere ?? {},
				{
					RAW: (table: any) => {
						return sql`GREATEST(${sql.join(
							Object.entries(tableSchema.columns).map(([key]) => {
								return sql`similarity(${table[key]}::TEXT, ${args.search})`;
							}),
							sql.raw(", "),
						)}) > ${search.threshold ?? 0.1}`;
					},
				},
			],
		};
	}
}
