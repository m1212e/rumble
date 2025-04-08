import type SchemaBuilder from "@pothos/core";
import { capitalizeFirstLetter } from "./helpers/capitalize";
import { assertFindFirstExists } from "./helpers/helper";
import type { MakePubSubInstanceType } from "./pubsub";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
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
	return <ExplicitTableName extends keyof NonNullable<DB["_"]["schema"]>>({
		tableName,
		readAction = "read" as Action,
		listAction = "read" as Action,
	}: {
		/**
		 * The table for which to implement the query
		 */
		tableName: ExplicitTableName;
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
		const tableSchema = (db._.schema as NonNullable<DB["_"]["schema"]>)[
			tableName
		];
		if (!tableSchema) {
			throw new RumbleError(
				`Could not find schema for ${tableName.toString()} (query)`,
			);
		}
		const primaryKey = tableSchema.primaryKey.at(0)?.name;
		if (!primaryKey)
			console.warn(
				`Could not find primary key for ${tableName.toString()}. Cannot register subscriptions!`,
			);

		const {
			inputType: WhereArg,
			transformArgumentToQueryCondition: transformWhere,
		} = argImplementer({
			tableName: tableName,
		});

		const { registerOnInstance } = makePubSubInstance({ tableName });

		return schemaBuilder.queryFields((t) => {
			return {
				[`findMany${capitalizeFirstLetter(tableName.toString())}`]:
					t.drizzleField({
						type: [tableName],
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
							const filter = ctx.abilities[tableName as any].filter(
								listAction,
								{
									inject: { where: transformWhere(args.where) },
								},
							);

							const queryInstance = query(filter as any);

							if (filter.columns) {
								queryInstance.columns = filter.columns;
							}

							return db.query[tableName as any].findMany(queryInstance);
						},
					}),
				[`findFirst${capitalizeFirstLetter(tableName.toString())}`]:
					t.drizzleField({
						type: tableName,
						nullable: false,
						smartSubscription: true,
						args: {
							where: t.arg({ type: WhereArg, required: false }),
						},
						resolve: (query, root, args, ctx, info) => {
							const filter = ctx.abilities[tableName as any].filter(
								readAction,
								{
									inject: { where: transformWhere(args.where) },
								},
							);

							const queryInstance = query(filter as any);

							if (filter.columns) {
								queryInstance.columns = filter.columns;
							}

							return db.query[tableName as any]
								.findFirst(queryInstance)
								.then(assertFindFirstExists);
						},
					}),
			};
		});
	};
};
