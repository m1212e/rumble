import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { clone, cloneDeep } from "es-toolkit";
import { plural, singular } from "pluralize";
import { assertFindFirstExists } from "./helpers/helper";
import {
	type TableIdentifierTSName,
	tableHelper,
} from "./helpers/tableHelpers";
import type { OrderArgImplementerType } from "./orderArg";
import type { MakePubSubInstanceType } from "./pubsub";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";
import type { WhereArgImplementerType } from "./whereArg";

// TODO: consider removing the whole inject helper thing since we dont need a syntax transform anymore

export const createQueryImplementer = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
	SchemaBuilder extends SchemaBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
	WhereArgImplementer extends WhereArgImplementerType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
	OrderArgImplementer extends OrderArgImplementerType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
	MakePubSubInstance extends MakePubSubInstanceType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
>({
	db,
	schemaBuilder,
	search,
	whereArgImplementer,
	orderArgImplementer,
	makePubSubInstance,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	schemaBuilder: SchemaBuilder;
	whereArgImplementer: WhereArgImplementer;
	orderArgImplementer: OrderArgImplementer;
	makePubSubInstance: MakePubSubInstance;
}) => {
	return <ExplicitTableName extends TableIdentifierTSName<DB>>({
		table,
		readAction = "read" as Action,
		listAction = "read" as Action,
	}: {
		/**
		 * The table for which to implement the query
		 */
		table: ExplicitTableName;
		/**
		 * Which action should be used for reading single entities
		 * @default "read"
		 */
		readAction?: Action;
		/**
		 * Which action should be used for listing many entities
		 * @default "read"
		 */
		listAction?: Action;
	}) => {
		const WhereArg = whereArgImplementer({
			table: table,
		});
		const OrderArg = orderArgImplementer({
			table: table,
		});
		const tableSchema = tableHelper({
			db,
			tsName: table!,
		});
		const primaryKeyField = Object.values(tableSchema.primaryColumns)[0];

		const { registerOnInstance } = makePubSubInstance({ table: table });

		return schemaBuilder.queryFields((t) => {
			const manyArgs = {
				where: t.arg({ type: WhereArg, required: false }),
				orderBy: t.arg({ type: OrderArg, required: false }),
				limit: t.arg.int({ required: false }),
				offset: t.arg.int({ required: false }),
				search: t.arg.string({ required: false }),
			};

			if (!search?.enabled) {
				delete (manyArgs as any).search;
			}

			return {
				[plural(table.toString())]: t.drizzleField({
					type: [table],
					nullable: false,
					smartSubscription: true,
					subscribe: (subscriptions, root, args, ctx, info) => {
						registerOnInstance({
							instance: subscriptions,
							action: "created",
						});
						registerOnInstance({
							instance: subscriptions,
							action: "removed",
						});
					},
					args: manyArgs,
					resolve: (query, root, args, ctx, info) => {
						// transform null prototyped object
						args = JSON.parse(JSON.stringify(args));

						// TODO: in general, several of the filter methods should be more
						// restrictive in case of explicitly allowed columns
						// search, order and filter should be restricted to allowed cols
						// and should completely ignore other fields since one might be ably
						// to narrow down and guess the actual values behind forbidden columns by
						// using the provided args. This way one could guess, e.g. secrets which are forbidden by
						// the column abilitiy settings but will be respected in searches, etc.
						if (search?.enabled && args.search && args.search.length > 0) {
							const originalOrderBy = cloneDeep(args.orderBy);
							(args as any).orderBy = (table) => {
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

								// GREATEST(similarity(name, ${query.search}), similarity(description, ${query.search})) DESC
								const searchSQL = sql`GREATEST(${sql.join(
									Object.entries(tableSchema.columns).map(([key, value]) => {
										return sql`similarity(${table[key]}::TEXT, ${args.search})`;
									}),
									sql.raw(", "),
								)}) DESC`;

								const ret = originalOrderBy
									? sql.join([argsOrderBySQL, searchSQL], sql.raw(", "))
									: searchSQL;

								return ret;
							};
						}

						const filter = ctx.abilities[table as any].filter(
							listAction,
							args.where || args.limit || args.offset
								? {
										inject: {
											where: args.where,
											limit: args.limit,
										},
									}
								: undefined,
						).query.many;

						if (args.offset) {
							(filter as any).offset = args.offset;
						}

						if (args.orderBy) {
							(filter as any).orderBy = args.orderBy;
						}

						const queryInstance = query(filter as any);

						if (filter.columns) {
							queryInstance.columns = filter.columns;
						}

						return db.query[table as any].findMany(queryInstance);
					},
				}),
				[singular(table.toString())]: t.drizzleField({
					type: table,
					nullable: false,
					smartSubscription: true,
					args: {
						// where: t.arg({ type: WhereArg, required: false }),
						id: t.arg.id({ required: true }),
					},
					resolve: (query, root, args, ctx, info) => {
						// transform null prototyped object
						args = JSON.parse(JSON.stringify(args));

						const filter = ctx.abilities[table as any].filter(readAction, {
							inject: { where: { [primaryKeyField.name]: args.id } },
						}).query.single;

						const queryInstance = query(filter as any);

						if (filter.columns) {
							queryInstance.columns = filter.columns;
						}

						return db.query[table as any]
							.findFirst(queryInstance)
							.then(assertFindFirstExists);
					},
				}),
			};
		});
	};
};
