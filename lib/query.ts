import { sql } from "drizzle-orm";
import pluralize from "pluralize";
import type { OrderArgImplementerType } from "./args/orderArg";
import type { WhereArgImplementerType } from "./args/whereArg";
import { assertFindFirstExists } from "./helpers/asserts";
import { isPostgresDB } from "./helpers/determineDialectFromSchema";
import { mapNullFieldsToUndefined } from "./helpers/mapNullFieldsToUndefined";
import { deepSetProto } from "./helpers/protoMapper";
import { tableHelper } from "./helpers/tableHelpers";
import type { MakePubSubInstanceType } from "./pubsub";
import { adjustQueryArgsForSearch } from "./search";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
} from "./types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";
import type { SchemaBuilderType } from "./types/schemaBuilderType";

export const createQueryImplementer = <
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
  return <TableName extends keyof DrizzleQueryFunction<DB>>({
    table,
    readAction = "read" as Action,
    listAction = "read" as Action,
  }: {
    /**
     * The table for which to implement the query
     */
    table: TableName;
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
      table,
    });
    const primaryKeyField = Object.values(tableSchema.primaryKey)[0];

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
        [pluralize.plural(table.toString())]: t.drizzleField({
          type: [table],
          nullable: false,
          smartSubscription: true,
          description: `List all ${pluralize.plural(table.toString())}`,
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
          args: manyArgs,
          resolve: (query, _root, args, ctx, _info) => {
            // args does not have Object.prototype as prototype, so we need to set it
            // otherwise some libraries (like drizzle-orm) might have issues with it
            deepSetProto(args);

            adjustQueryArgsForSearch({
              search,
              args,
              tableSchema,
              abilities: ctx.abilities[table].filter(listAction),
            });

            const mappedArgs = mapNullFieldsToUndefined(args);
            const filter = ctx.abilities[table]
              .filter(listAction)
              .merge(mappedArgs as any).query.many;

            if (mappedArgs.offset) {
              (filter as any).offset = mappedArgs.offset;
            }

            if (mappedArgs.orderBy) {
              (filter as any).orderBy = mappedArgs.orderBy;
            }

            const queryInstance = query(filter as any);

            if ((filter as any).columns) {
              queryInstance.columns = (filter as any).columns;
            }

            if (search?.cpu_operator_cost) {
              return db.transaction(async (tx) => {
                if (isPostgresDB(tx)) {
                  await tx.execute(
                    sql`SET LOCAL cpu_operator_cost = ${search.cpu_operator_cost};`,
                  );
                } else {
                  console.info(
                    "Database dialect is not postgresql, cannot set cpu_operator_cost.",
                  );
                }
                return (tx.query as any)[table].findMany(queryInstance);
              });
            }

            return (db.query as any)[table].findMany(queryInstance);
          },
        }),
        [pluralize.singular(table.toString())]: t.drizzleField({
          type: table,
          nullable: false,
          smartSubscription: true,
          description: `Get a single ${pluralize.singular(table.toString())} by ID`,
          args: {
            id: t.arg.id({ required: true }),
          },
          resolve: (query, _root, args, ctx, _info) => {
            deepSetProto(args);

            const filter = (ctx.abilities as any)[table]
              .filter(readAction)
              .merge({ where: { [primaryKeyField.name]: args.id } })
              .query.single;
            const q = query(filter);

            if (filter.columns) {
              q.columns = filter.columns;
            }

            return (db.query as any)[table]
              .findFirst(q)
              .then(assertFindFirstExists);
          },
        }),
      };
    });
  };
};
