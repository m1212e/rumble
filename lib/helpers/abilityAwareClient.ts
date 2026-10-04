import type { AbilityBuilderType } from "../abilityBuilder";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import { mergeFilters } from "./mergeFilters";

// pothos reloads rows by primary key when a resolver returned them without
// query(...). Those reloads are its only use of client.query, so the read
// abilities are applied there: the ones the request masked rows of the table
// with (e.g. a list action), or the table's read action if there are none.
export function createAbilityAwareClient<DB extends DrizzleInstance>({
  db,
  abilityBuilder,
}: {
  db: DB;
  abilityBuilder: AbilityBuilderType<any, DB, any, any, any>;
}) {
  return (context: { abilities: Record<string, any> }) => {
    const apis = new Map<string, unknown>();

    const query = new Proxy(db.query as Record<string, any>, {
      get(target, table, receiver) {
        const api = Reflect.get(target, table, receiver);
        if (typeof table !== "string" || !context.abilities?.[table]) {
          return api;
        }

        let wrapped = apis.get(table);
        if (!wrapped) {
          wrapped = Object.create(api, {
            findMany: {
              value: async (config: Record<string, any> = {}) => {
                const masked = abilityBuilder._.maskedActions(
                  context.abilities,
                  table as any,
                );
                const actions = masked.size
                  ? [...masked]
                  : [abilityBuilder._.readActionOf(table as any)];

                // one query per action, since each brings its own column flag.
                // A row found by several is matched by pothos once.
                const rowsPerAction = await Promise.all(
                  actions.map(async (action) => {
                    const ability = (
                      await context.abilities[table].filter(action)
                    ).query.many;
                    const { where, extras } = mergeFilters(
                      { where: config.where, extras: config.extras },
                      { where: ability.where, extras: ability.extras },
                    );

                    const rows = await api.findMany({
                      ...config,
                      where,
                      extras,
                    });
                    await abilityBuilder._.maskColumns({
                      table: table as any,
                      action,
                      abilities: context.abilities,
                      entities: rows,
                    });
                    return rows;
                  }),
                );
                return rowsPerAction.flat();
              },
            },
          });
          apis.set(table, wrapped);
        }
        return wrapped;
      },
    });

    return new Proxy(db, {
      get(target, prop, receiver) {
        return prop === "query" ? query : Reflect.get(target, prop, receiver);
      },
    });
  };
}
