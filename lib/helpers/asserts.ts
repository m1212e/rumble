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
