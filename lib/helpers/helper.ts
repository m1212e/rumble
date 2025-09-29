import type { Filter } from "../runtimeFiltersPlugin/pluginTypes";
import { RumbleErrorSafe } from "../types/rumbleError";

/**
 * 
 * Helper function to map a drizzle findFirst query result,
 * which may be optional, to a correct drizzle type.
 * 
 * @throws RumbleError
 * 
 * @example
 * 
 * ```ts
 * schemaBuilder.queryFields((t) => {
   return {
     findFirstUser: t.drizzleField({
       type: UserRef,
       resolve: (query, root, args, ctx, info) => {
         return (
           db.query.users
             .findFirst({
               ...query,
               where: ctx.abilities.users.filter("read").single.where,
             })
             // note that we need to manually raise an error if the value is not found
             .then(assertFindFirstExists)
         );
       },
     }),
   };
 });
 * ```
 */
export const assertFindFirstExists = <T>(value: T | undefined): T => {
  if (!value)
    throw new RumbleErrorSafe("Value not found but required (findFirst)");
  return value;
};

/**
 * 
 * Helper function to map a drizzle findFirst query result,
 * which may be optional, to a correct drizzle type.
 * 
 * @throws RumbleError
 * 
 * @example
 * 
 * ```ts
  schemaBuilder.mutationFields((t) => {
    return {
      updateUsername: t.drizzleField({
        type: UserRef,
        args: {
          userId: t.arg.int({ required: true }),
          newName: t.arg.string({ required: true }),
        },
        resolve: (query, root, args, ctx, info) => {
          return db
            .update(schema.users)
            .set({
              name: args.newName,
            })
            .where(
              and(
                eq(schema.users.id, args.userId),
                ctx.abilities.users.filter("update").single.where
              )
            )
            .returning({ id: schema.users.id, name: schema.users.name })
        // note that we need to manually raise an error if the value is not found
            .then(assertFirstEntryExists);
        },
      }),
    };
  });
 * ```
 */
export const assertFirstEntryExists = <T>(value: T[]): T => {
  const v = value.at(0);
  if (!v)
    throw new RumbleErrorSafe("Value not found but required (firstEntry)");
  return v;
};

/**
 * A helper to apply a list of filters to a given list of entities.
 * 
 * @example
 * 
 * ```ts
 * const filtered = await applyFilters({
    filters: abilityBuilder.registeredFilters.posts.update,
    entities: entitiesToFilter,
    context: ctx,
  });
 * ```
 */
export const applyFilters = async <Context, T, H extends T>({
  filters,
  entities,
  context,
}: {
  entities: T[];
  filters: Filter<Context, H>[];
  context: Context;
}) => {
  return Array.from(
    (
      await Promise.all(
        filters.map((f) =>
          f({
            context,
            entities: entities as H[],
          }),
        ),
      )
    ).reduce((acc, val) => {
      val.forEach((v) => acc.add(v));
      return acc;
      // since multiple helpers might return the same entity we use a set to deduplicate
    }, new Set<T>()),
  );
};

/**
 * Helper to map null fields to undefined
 * @param obj The object to map
 * @returns The mapped object with all fields of 'null' transformed to 'undefined'
 * 
 * This becomes useful for update mutations where you do not want to pass null (unset value in db)
 * but undefined (do not touch value in db) in case of a value not beeing set in the args of said mutation
 * @example
 * ```ts
 *  updateUser: t.drizzleField({
      type: User,
      args: {
        id: t.arg.string({ required: true }),
        email: t.arg.string(),
        lastName: t.arg.string(),
        firstName: t.arg.string(),
      },
      resolve: async (query, root, args, ctx, info) => {
        const mappedArgs = mapNullFieldsToUndefined(args);
        const user = await db.transaction(async (tx) => {
          const user = await tx
            .update(schema.user)
            .set({

              // email: args.email ?? undefined,
              // lastName: args.lastName ?? undefined,
              // firstName: args.firstName ?? undefined,

              // becomes this

              email: mappedArgs.email,
              lastName: mappedArgs.lastName,
              firstName: mappedArgs.firstName,
            })
            .returning()
            .then(assertFirstEntryExists);
          return user;
        });

        pubsub.updated(user.id);

        return db.query.user
          .findFirst(
            query(
              ctx.abilities.user.filter('read', {
                inject: {
                  where: { id: user.id },
                },
              }).query.single,
            ),
          )
          .then(assertFindFirstExists);
      },
    }),
 * 
 * 
 * ```
 */
export function mapNullFieldsToUndefined<T extends object>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      value === null ? undefined : value,
    ]),
  ) as {
    [K in keyof T]: T[K] extends null ? undefined : Exclude<T[K], null>;
  };
}
