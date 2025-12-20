import type { FieldMap } from "@pothos/core";
import type { DrizzleObjectFieldBuilder } from "@pothos/plugin-drizzle";
import { One } from "drizzle-orm";
import { capitalize } from "es-toolkit";
import pluralize from "pluralize";
import type { AbilityBuilderType } from "./abilityBuilder";
import type { OrderArgImplementerType } from "./args/orderArg";
import type { WhereArgImplementerType } from "./args/whereArg";
import { type EnumImplementerType, isEnumSchema } from "./enum";
import { buildPothosResponseTypeFromGraphQLType } from "./helpers/sqlTypes/mapDrizzleTypeToGraphQlType";
import type { PossibleSQLType } from "./helpers/sqlTypes/types";
import { tableHelper } from "./helpers/tableHelpers";
import type { MakePubSubInstanceType } from "./pubsub";
import { adjustQueryArgsForSearch } from "./search";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
  DrizzleTableValueType,
} from "./types/drizzleInstanceType";
import { RumbleError } from "./types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";
import type { SchemaBuilderType } from "./types/schemaBuilderType";

// TODO remove as many as any types as possible here

//TODO this is a bit flaky, we should check if we can determine the config object more reliably
//TODO maybe a plugin can place some marker field on these objects?
// like this?
// if (t instanceof DrizzleObjectOptions) {
//   return true;
// }

const isProbablyAConfigObject = (t: any) => {
  if (typeof t !== "object") {
    return false;
  }

  if (
    Object.keys(t).some((k) =>
      [
        "args",
        "nullable",
        "query",
        "subscribe",
        "description",
        "type",
        "resolve",
      ].find((e) => e === k),
    )
  )
    return true;
  return false;
};

export const createObjectImplementer = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
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
  EnumImplementer extends EnumImplementerType<
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
  AbilityBuilderInstance extends AbilityBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >,
>({
  db,
  search,
  schemaBuilder,
  makePubSubInstance,
  whereArgImplementer,
  orderArgImplementer,
  enumImplementer,
  abilityBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  schemaBuilder: SchemaBuilder;
  whereArgImplementer: WhereArgImplementer;
  orderArgImplementer: OrderArgImplementer;
  enumImplementer: EnumImplementer;
  makePubSubInstance: MakePubSubInstance;
  abilityBuilder: AbilityBuilderInstance;
}) => {
  return <
    TableName extends keyof DrizzleQueryFunction<DB>,
    RefName extends string,
  >({
    table,
    refName,
    readAction = "read" as Action,
    adjust,
  }: {
    /**
     * The table you want to be used as reference for the object creation.
     */
    table: TableName;
    /**
     * The name you want this object to have in your graphql schema.
     * Rumble will create a reasonable default if not specified.
     */
    refName?: RefName;
    /**
     * The action used for read access to the table.
     * Defaults to "read".
     */
    readAction?: Action;
    /**
     * A function which can be used to adjust the fields of the object.
     * You can extend the object by specifying fields that do not exist as
     * per your db schema, or overwrite existing fields with the same name.
     * In case you do overwrite, rumble will set proper nullability and
     * subscription properties if you do not specify them explicitly.
     */
    adjust?:
      | ((
          t: DrizzleObjectFieldBuilder<
            SchemaBuilder["$inferSchemaTypes"],
            SchemaBuilder["$inferSchemaTypes"]["DrizzleRelations"][TableName],
            DrizzleTableValueType<DB, TableName>
          >,
        ) => FieldMap)
      | undefined;
  }) => {
    const tableSchema = tableHelper({ db, table });

    if (Object.keys(tableSchema.primaryKey).length === 0) {
      console.warn(
        `Could not find primary key for ${table.toString()}. Cannot register subscriptions!`,
      );
    }
    const primaryKey = Object.values(tableSchema.primaryKey)[0];

    const { registerOnInstance } = makePubSubInstance({ table: table });

    return schemaBuilder.drizzleObject(table, {
      name: refName ?? capitalize(table.toString()),
      subscribe: (subscriptions, element, _context) => {
        if (!primaryKey) return;
        const primaryKeyValue = (element as any)[primaryKey.name];
        if (!primaryKeyValue) {
          console.warn(
            `Could not find primary key value for ${JSON.stringify(
              element,
            )}. Cannot register subscription!`,
          );
          return;
        }

        //TODO maybe register non specific update calls aswell?
        registerOnInstance({
          instance: subscriptions,
          action: "updated",
          primaryKeyValue: primaryKeyValue,
        });
      },
      applyFilters: abilityBuilder?._.registeredFilters({
        table,
        action: readAction,
      }),
      fields: (t) => {
        const columns = tableSchema.columns;

        // in case the user makes adjustments we want to store away which
        // pothos function was called with what config
        // this is mapped to the ref which later can be used to
        // reference these parameters while iterating over the fields
        // and checking against the userAdjustments object
        // this is necessary to e.g. merge nullability info from the database schema
        // or register subscriptions on relations
        const configMap = new Map<
          any,
          {
            creatorFunction: (...p: any[]) => any;
            params: any[];
            configObject: any;
          }
        >();
        // stores the results of the user adjustments
        // also stores all the used pothos functions and the configs
        // provided by the user so we can extend that if necessary
        const userAdjustments =
          adjust?.(
            new Proxy(t, {
              get: (target, prop) => {
                if (
                  // we only care for field/relation functions
                  typeof (target as any)[prop] !== "function" ||
                  prop === "arg" ||
                  prop === "builder" ||
                  prop === "graphqlKind" ||
                  prop === "kind" ||
                  prop === "listRef" ||
                  prop === "table" ||
                  prop === "typename" ||
                  prop === "variant" ||
                  prop.toString().startsWith("boolean") ||
                  prop.toString().startsWith("float") ||
                  prop.toString().startsWith("id") ||
                  prop.toString().startsWith("int") ||
                  prop.toString().startsWith("string") ||
                  prop.toString().startsWith("expose")
                ) {
                  return (target as any)[prop];
                }

                return (...params: any[]) => {
                  const ref = (target as any)[prop](...params);
                  const configObject = params.find(isProbablyAConfigObject);
                  if (!configObject)
                    throw new RumbleError(
                      "Expected config object to be passed to adjust field",
                    );

                  configMap.set(ref, {
                    params,
                    creatorFunction: (target as any)[prop],
                    configObject,
                  });
                  return ref;
                };
              },
            }) as any,
          ) ?? {};

        const fields = Object.entries(columns).reduce(
          (acc, [key, value]) => {
            // in case the user wants to overwrite a field
            // we want to merge with our stuff in case the user
            // did not specify it themselves
            if (userAdjustments[key]) {
              const { params, creatorFunction, configObject } = configMap.get(
                userAdjustments[key],
              )!;

              if (typeof configObject.nullable !== "boolean") {
                configObject.nullable = !value.notNull;
              }

              userAdjustments[key] = creatorFunction.bind(t)(...params);
              return acc;
            }

            if (isEnumSchema(value)) {
              const enumImpl = enumImplementer({
                enumColumn: value,
              });

              acc[key] = t.field({
                type: enumImpl,
                resolve: (element) => (element as any)[key],
                nullable: !value.notNull,
              });
            } else {
              acc[key] = buildPothosResponseTypeFromGraphQLType({
                builder: t,
                sqlType: value.getSQLType() as PossibleSQLType,
                fieldName: key,
                nullable: !value.notNull,
              });
            }
            return acc;
          },
          {} as Record<
            keyof typeof columns,
            | ReturnType<typeof buildPothosResponseTypeFromGraphQLType>
            | ReturnType<typeof t.field>
          >,
        );

        const relations = Object.entries(tableSchema.relations ?? {}).reduce(
          (acc, [key, value]) => {
            const relationSchema = tableHelper({
              db,
              table: (value as any).targetTable,
            });
            const WhereArg = whereArgImplementer({
              dbName: relationSchema.dbName,
            });
            const OrderArg = orderArgImplementer({
              dbName: relationSchema.dbName,
            });
            const relationTablePubSub = makePubSubInstance({
              table: relationSchema.tsName as any,
            });

            // many relations will return an empty array so we just don't set them nullable
            let nullable = false;
            let isMany = true;
            let filterSpecifier = "many";
            if (value instanceof One) {
              isMany = false;
              nullable = (value as any).optional;
              filterSpecifier = "single";
            }

            const subscribe = (subscriptions: any, _element: any) => {
              relationTablePubSub.registerOnInstance({
                instance: subscriptions,
                action: "created",
              });
              relationTablePubSub.registerOnInstance({
                instance: subscriptions,
                action: "removed",
              });
            };

            // in case the user wants to overwrite a field
            // we want to merge with our stuff in case the user
            // did not specify it themselves
            if (userAdjustments[key]) {
              const { params, creatorFunction, configObject } = configMap.get(
                userAdjustments[key],
              )!;

              if (typeof configObject.nullable !== "boolean") {
                configObject.nullable = nullable;
              }

              if (typeof configObject.subscribe !== "function") {
                configObject.subscribe = subscribe;
              }

              userAdjustments[key] = creatorFunction.bind(t)(...params);
              return acc;
            }

            const args = {
              where: t.arg({ type: WhereArg, required: false }),
              orderBy: t.arg({ type: OrderArg, required: false }),
              ...(isMany
                ? {
                    offset: t.arg.int({ required: false }),
                    limit: t.arg.int({ required: false }),
                  }
                : {}),
              search: t.arg.string({ required: false }),
            };

            if (!search?.enabled || !isMany) {
              delete (args as any).search;
            }

            (acc as any)[key] = t.relation(
              key as any,
              {
                args,
                subscribe,
                nullable,
                description: `Get the ${pluralize.plural(relationSchema.tsName)} related to this ${pluralize.singular(tableSchema.tsName)}`,
                query: (args: any, ctx: any) => {
                  // transform null prototyped object
                  args = JSON.parse(JSON.stringify(args));

                  if (isMany) {
                    adjustQueryArgsForSearch({
                      search,
                      args,
                      tableSchema: relationSchema,
                      abilities:
                        ctx.abilities[relationSchema.tsName].filter(readAction),
                    });
                  }

                  const filter = ctx.abilities[relationSchema.tsName]
                    .filter(readAction)
                    .merge({
                      where: args.where,
                      limit: args.limit,
                      extras: args.extras,
                    }).query[filterSpecifier];

                  if (args.offset) {
                    (filter as any).offset = args.offset;
                  }

                  if (args.orderBy) {
                    (filter as any).orderBy = args.orderBy;
                  }

                  return filter;
                },
              } as any,
            ) as any;
            return acc;
          },
          {} as Record<
            keyof typeof tableSchema.relations,
            ReturnType<typeof buildPothosResponseTypeFromGraphQLType>
          >,
        );

        if (search?.enabled) {
          if (fields.search_distance) {
            throw new Error(
              "Reserved field name 'search_distance' found on " +
                tableSchema.tsName +
                ". If search is enabled, the 'search_distance' field is automatically added and cannot be defined manually.",
            );
          }

          fields.search_distance = t.float({
            description:
              "The search distance of the object. If a search is provided, this field will be populated with the search distance.",
            nullable: true,
            resolve: (parent, args, ctx, info) =>
              (parent as any).search_distance,
          });
        }

        return {
          ...fields,
          ...relations,
          ...userAdjustments,
        };
      },
    });
  };
};
