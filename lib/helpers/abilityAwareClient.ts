import type { AbilityBuilderType } from "../abilityBuilder";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import { realWhere } from "./mergeFilters";

// pothos reloads rows by primary key when a resolver returned them without
// query(...). Those reloads are its only use of client.query, so the read
// abilities are applied there.
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
                const action = abilityBuilder._.readActionOf(table as any);
                const ability = (await context.abilities[table].filter(action))
                  .query.many;
                const where = realWhere(ability.where);

                const rows = await api.findMany({
                  ...config,
                  where: where
                    ? config.where
                      ? { AND: [where, config.where] }
                      : where
                    : config.where,
                  extras: ability.extras
                    ? { ...config.extras, ...ability.extras }
                    : config.extras,
                });

                await abilityBuilder._.maskColumns({
                  table: table as any,
                  action,
                  abilities: context.abilities,
                  entities: rows,
                });
                return rows;
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
