import { capitalizeFirstLetter } from "./helpers/capitalize";
import { assertFindFirstExists } from "./helpers/helper";
import type { MakePubSubInstanceType } from "./pubsub";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";
import type { ArgImplementerType } from "./whereArg";

export const createQueryImplementer = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	SchemaBuilder extends SchemaBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
	ArgImplementer extends ArgImplementerType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
	MakePubSubInstance extends MakePubSubInstanceType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
>({
	db,
	schemaBuilder,
	argImplementer,
	makePubSubInstance,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
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
		const schema = (db._.schema as NonNullable<DB["_"]["schema"]>)[tableName];
		const primaryKey = schema.primaryKey.at(0)?.name;
		if (!primaryKey)
			console.warn(
				`Could not find primary key for ${tableName.toString()}. Cannot register subscriptions!`,
			);

		const {
			inputType: WhereArg,
			transformArgumentToQueryCondition: transformWhere,
		} = argImplementer({
			tableName: tableName,
			name: `${tableName.toString()}Where_DefaultRumbleQueryArgument`,
		});

		const { registerOnInstance } = makePubSubInstance({ tableName });

		return schemaBuilder.queryFields((t) => {
			return {
				[`findMany${capitalizeFirstLetter(tableName.toString())}`]:
					t.drizzleField({
						type: [tableName],
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
							return db.query[tableName as any].findMany(
								query(
									ctx.abilities[tableName as any].filter(listAction, {
										inject: { where: transformWhere(args.where) },
									}),
								),
							);
						},
					}),
				[`findFirst${capitalizeFirstLetter(tableName.toString())}`]:
					t.drizzleField({
						type: tableName,
						smartSubscription: true,
						args: {
							where: t.arg({ type: WhereArg, required: false }),
						},
						resolve: (query, root, args, ctx, info) => {
							return db.query[tableName as any]
								.findFirst(
									query(
										ctx.abilities[tableName as any].filter(readAction, {
											inject: { where: transformWhere(args.where) },
										}) as any,
									),
								)
								.then(assertFindFirstExists);
						},
					}),
			};
		});
	};
};
