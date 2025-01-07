import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import { and, eq } from "drizzle-orm";
import { type YogaServerOptions, createYoga } from "graphql-yoga";
import { createAbilityBuilder } from "../abilities/builder";
import { RumbleError } from "../helpers/rumbleError";
import type {
	GenericDrizzleDbTypeConstraints,
	QueryConditionObject,
} from "../types/genericDrizzleDbType";

export const rumble = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string = "create" | "read" | "update" | "delete",
>({
	db,
	nativeServerOptions,
	context: makeUserContext,
	onlyQuery = false,
	actions = ["create", "read", "update", "delete"] as Action[],
}: {
	/**
	 * Your drizzle database instance
	 */
	db: DB;
	/**
	 * Optional options for the native GraphQL Yoga server
	 */
	nativeServerOptions?:
		| Omit<YogaServerOptions<RequestEvent, any>, "schema" | "context">
		| undefined;
	/**
	 * A function for providing context for each request based on the incoming HTTP Request.
	 * The type of the parameter equals the HTTPRequest type of your chosen server.
	 */
	context?:
		| ((event: RequestEvent) => Promise<UserContext> | UserContext)
		| undefined;
	/**
	 * If you only want to create queries and do not need mutations, enable this
	 */
	onlyQuery?: boolean;
	/**
	 * The actions that are available
	 */
	actions?: Action[];
}) => {
	const abilityBuilder = createAbilityBuilder<UserContext, DB, Action>({
		db,
	});

	const makeContext = async (req: RequestEvent) => {
		const userContext = makeUserContext
			? await makeUserContext(req)
			: ({} as UserContext);
		return {
			...userContext,
			abilities: abilityBuilder.buildWithUserContext(userContext),
		};
	};

	const nativeBuilder = new SchemaBuilder<{
		Context: Awaited<ReturnType<typeof makeContext>>;
		// Scalars: Scalars<Prisma.Decimal, Prisma.InputJsonValue | null, Prisma.InputJsonValue> & {
		// 	File: {
		// 		Input: File;
		// 		Output: never;
		// 	};
		// 	JSONObject: {
		// 		Input: any;
		// 		Output: any;
		// 	};
		// };
		DrizzleSchema: DB["_"]["fullSchema"];
	}>({
		plugins: [DrizzlePlugin],
		drizzle: {
			client: db,
		},
	});

	nativeBuilder.queryType({});

	if (!onlyQuery) {
		nativeBuilder.mutationType({});
	}

	const implementDefaultObject = <
		ExplicitTableName extends keyof NonNullable<DB["_"]["schema"]>,
		RefName extends string,
	>({
		tableName,
		name,
		readAction = "read" as Action,
	}: {
		tableName: ExplicitTableName;
		name: RefName;
		readAction?: Action;
	}) => {
		const schema = (db._.schema as NonNullable<DB["_"]["schema"]>)[tableName];

		return nativeBuilder.drizzleObject(tableName, {
			name,
			fields: (t) => {
				const mapSQLTypeStringToExposedPothosType = <
					Column extends keyof typeof schema.columns,
					SQLType extends ReturnType<
						(typeof schema.columns)[Column]["getSQLType"]
					>,
				>(
					sqlType: SQLType,
					columnName: Column,
				) => {
					switch (sqlType) {
						case "serial":
							// @ts-expect-error
							return t.exposeInt(columnName);
						case "int":
							// @ts-expect-error
							return t.exposeInt(columnName);
						case "string":
							// @ts-expect-error
							return t.exposeString(columnName);
						case "text":
							// @ts-expect-error
							return t.exposeString(columnName);
						case "boolean":
							// @ts-expect-error
							return t.exposeBoolean(columnName);
						default:
							throw new RumbleError(
								`Unknown SQL type: ${sqlType}. Please open an issue so it can be added.`,
							);
					}
				};

				const fields = Object.entries(schema.columns).reduce(
					(acc, [key, value]) => {
						acc[key] = mapSQLTypeStringToExposedPothosType(
							value.getSQLType(),
							key,
						);
						return acc;
					},
					{} as Record<
						keyof typeof schema.columns,
						ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					>,
				);

				const relations = Object.entries(schema.relations).reduce(
					(acc, [key, value]) => {
						acc[key] = t.relation(key, {
							query: (_args: any, ctx: any) =>
								ctx.abilities[key].filter(readAction),
						} as any) as any;
						return acc;
					},
					{} as Record<
						keyof typeof schema.relations,
						ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					>,
				);

				return {
					...fields,
					...relations,
				};
			},
		});
	};

	const implementWhereArgType = <
		ExplicitTableName extends keyof NonNullable<DB["_"]["schema"]>,
		RefName extends string,
	>({
		tableName,
		name,
	}: {
		tableName: ExplicitTableName;
		name?: RefName | undefined;
	}) => {
		const schema = (db._.schema as NonNullable<DB["_"]["schema"]>)[tableName];

		const inputType = nativeBuilder.inputType(
			name ??
				`${
					String(tableName).charAt(0).toUpperCase() + String(tableName).slice(1)
				}WhereInputArgument`,
			{
				fields: (t) => {
					const mapSQLTypeStringToInputPothosType = <
						Column extends keyof typeof schema.columns,
						SQLType extends ReturnType<
							(typeof schema.columns)[Column]["getSQLType"]
						>,
					>(
						sqlType: SQLType,
						columnName: Column,
					) => {
						switch (sqlType) {
							case "serial":
								// @ts-expect-error
								return t.int(columnName, { required: false });
							case "int":
								// @ts-expect-error
								return t.int(columnName, { required: false });
							case "string":
								// @ts-expect-error
								return t.string(columnName, { required: false });
							case "text":
								// @ts-expect-error
								return t.string(columnName, { required: false });
							case "boolean":
								// @ts-expect-error
								return t.boolean(columnName, { required: false });
							default:
								throw new RumbleError(
									`Unknown SQL type: ${sqlType} (input). Please open an issue so it can be added.`,
								);
						}
					};

					const fields = Object.entries(schema.columns).reduce(
						(acc, [key, value]) => {
							acc[key] = mapSQLTypeStringToInputPothosType(
								value.getSQLType(),
								key,
							);
							return acc;
						},
						{} as Record<
							keyof typeof schema.columns,
							ReturnType<typeof mapSQLTypeStringToInputPothosType>
						>,
					);

					//     const relations = Object.entries(schema.relations).reduce(
					//       (acc, [key, value]) => {
					//         acc[key] = t.relation(key, {
					//           query: (_args: any, ctx: any) =>
					//             ctx.abilities[tableName].filter(readAction),
					//         } as any) as any;
					//         return acc;
					//       },
					//       {} as Record<
					//         keyof typeof schema.relations,
					//         ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					//       >
					//     );

					return {
						...fields,
						// ...relations,
					};
				},
			},
		);

		const transformArgumentToQueryCondition = <
			T extends typeof inputType.$inferInput,
		>(
			arg: T | null | undefined,
		) => {
			if (!arg) return undefined;
			const mapColumnToQueryCondition = <
				ColumnName extends keyof typeof schema.columns,
			>(
				columnname: ColumnName,
			) => {
				const column = schema.columns[columnname];
				const filterValue = arg[columnname];
				if (!filterValue) return;

				return eq(column, filterValue);
			};

			const conditions = Object.keys(schema.columns).map(
				mapColumnToQueryCondition,
			);
			return and(...conditions);
		};

		return { inputType, transformArgumentToQueryCondition };
	};

	return {
		/**
     * The ability builder. Use it to declare whats allowed for each entity in your DB.
     * 
     * @example
     * 
     * ```ts
     * // users can edit themselves
     abilityBuilder.users
       .allow(["read", "update", "delete"])
       .when(({ userId }) => ({ where: eq(schema.users.id, userId) }));
     
     // everyone can read posts
     abilityBuilder.posts.allow("read");
     * 
     * ```
     */
		abilityBuilder,
		/**
		 * The pothos schema builder. See https://pothos-graphql.dev/docs/plugins/drizzle
		 */
		schemaBuilder: nativeBuilder,
		/**
     * The native yoga instance. Can be used to run an actual HTTP server.
     * 
     * @example
     * 
     * ```ts
      import { createServer } from "node:http";
     * const server = createServer(yoga());
     server.listen(3000, () => {
          console.log("Visit http://localhost:3000/graphql");
     });
     * ```
     */
		yoga: () =>
			createYoga<RequestEvent>({
				...nativeServerOptions,
				schema: nativeBuilder.toSchema(),
				context: makeContext,
			}),
		/**
		 * A function for creating default objects for your schema
		 */
		implementDefaultObject,
		/**
		 * A function for creating where args to filter entities
		 */
		implementWhereArg: implementWhereArgType,
	};
};
