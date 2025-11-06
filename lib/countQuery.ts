import { count } from "drizzle-orm";
import pluralize from "pluralize";
import type { WhereArgImplementerType } from "./args/whereArg";
import { assertFirstEntryExists } from "./helpers/asserts";
import { mapNullFieldsToUndefined } from "./helpers/mapNullFieldsToUndefined";
import { deepSetProto } from "./helpers/protoMapper";
import { tableHelper } from "./helpers/tableHelpers";
import type { MakePubSubInstanceType } from "./pubsub";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
} from "./types/drizzleInstanceType";
import { RumbleErrorSafe } from "./types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";
import type { SchemaBuilderType } from "./types/schemaBuilderType";

export const createCountQueryImplementer = <
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
  whereArgImplementer,
  makePubSubInstance,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  schemaBuilder: SchemaBuilder;
  whereArgImplementer: WhereArgImplementer;
  makePubSubInstance: MakePubSubInstance;
}) => {
  return <TableName extends keyof DrizzleQueryFunction<DB>>({
    table,
    listAction = "read" as Action,
    isAllowed,
  }: {
    /**
     * The table for which to implement the count query
     */
    table: TableName;
    /**
     * Which action should be used for listing many entities
     * @default "read"
     */
    listAction?: Action;
    /**
     * Optional function to check if the query is allowed
     */
    isAllowed?: (context: UserContext) => boolean | Promise<boolean>;
  }) => {
    const WhereArg = whereArgImplementer({
      table: table,
    });
    const { registerOnInstance } = makePubSubInstance({ table: table });

    const tableSchema = tableHelper({
      db,
      table,
    });

    return schemaBuilder.queryFields((t) => {
      return {
        [`${pluralize.plural(table.toString())}Count`]: t.field({
          type: "Int",
          nullable: false,
          smartSubscription: true,
          description: `Count all ${pluralize.plural(table.toString())}`,
          subscribe: (subscriptions, _root, _args, _ctx, _info) => {
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
          resolve: async (root, args, ctx, info) => {
            if (isAllowed && !(await isAllowed(ctx))) {
              throw new RumbleErrorSafe("Not allowed to perform this action");
            }

            deepSetProto(args);

            return (db as any)
              .select({ count: count() })
              .from(tableSchema.fullSchema)
              .where(
                ctx.abilities[table]
                  .filter(listAction)
                  .merge(mapNullFieldsToUndefined(args) as any).sql.where,
              )
              .then(assertFirstEntryExists)
              .then((r: any) => r.count);
          },
        }),
      };
    });
  };
};
