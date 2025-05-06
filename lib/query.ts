import { capitalizeFirstLetter } from "./helpers/capitalize";
import { assertFindFirstExists } from "./helpers/helper";
import {
	type TableIdentifierTSName,
	tableHelper,
} from "./helpers/tableHelpers";
import type { MakePubSubInstanceType } from "./pubsub";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";
import type { ArgImplementerType } from "./whereArg";

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
	ArgImplementer extends ArgImplementerType<
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
	argImplementer,
	makePubSubInstance,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	schemaBuilder: SchemaBuilder;
	argImplementer: ArgImplementer;
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
		const WhereArg = argImplementer({
			table: table,
		});

		const { registerOnInstance } = makePubSubInstance({ table: table });

		return schemaBuilder.queryFields((t) => {
			return {
				[`findMany${capitalizeFirstLetter(table.toString())}`]: t.drizzleField({
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
					args: {
						where: t.arg({ type: WhereArg, required: false }),
					},
					resolve: (query, root, args, ctx, info) => {
						const filter = ctx.abilities[table as any].filter(
							listAction,
							args.where
								? {
										inject: { where: args.where },
									}
								: undefined,
						).query.many;

						const queryInstance = query(filter as any);

						if (filter.columns) {
							queryInstance.columns = filter.columns;
						}

						return db.query[table as any].findMany(queryInstance);
					},
				}),
				[`findFirst${capitalizeFirstLetter(table.toString())}`]: t.drizzleField(
					{
						type: table,
						nullable: false,
						smartSubscription: true,
						args: {
							where: t.arg({ type: WhereArg, required: false }),
						},
						resolve: (query, root, args, ctx, info) => {
							const filter = ctx.abilities[table as any].filter(
								readAction,
								args.where
									? {
											inject: { where: args.where },
										}
									: undefined,
							).query.single;

							const queryInstance = query(filter as any);

							if (filter.columns) {
								queryInstance.columns = filter.columns;
							}

							return db.query[table as any]
								.findFirst(queryInstance)
								.then(assertFindFirstExists);
						},
					},
				),
			};
		});
	};
};
