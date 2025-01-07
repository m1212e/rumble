# rumble
rumble is a combined ability and graphql builder built around [drizzle](https://orm.drizzle.team/docs/overview) and [pothos](https://pothos-graphql.dev/docs/plugins/drizzle), inspired by [CASL](https://casl.js.org/v6/en/). It takes much of the required configuration of your shoulders and makes creating a GraphQL server very easy!

> Please note that drizzle hasn't reached a full stable release yet and, as shown in the warning [here](https://pothos-graphql.dev/docs/plugins/drizzle), this is not stable yet.

> Using rumble and reading these docs requires some basic knowledge about the above mentioned tools. If you feel stuck, please make sure to familiarize yourself with those first!

> This is still in a very early stage and needs more testing. Please feel free to report everything you find/your feedback via the issues/discussion section of this repo!

## Getting started
The following example is an excerpt from the example setup you can find [here](./example).

First install into your existing TS project:
```
bun add @m1212e/rumble
npm i @m1212e/rumble
```
then call the rumble creator:
```ts
import * as schema from "./db/schema";
import { rumble } from "@m1212e/rumble";

export const db = drizzle(
  "postgres://postgres:postgres@localhost:5432/postgres",
  { schema }
);

const { abilityBuilder, schemaBuilder, yoga, implementDefaultObject } = rumble({ db });
```
> If the creation of a drizzle instance with the schema definition seems unfamiliar to you, please see their excellent [getting started guide](https://orm.drizzle.team/docs/get-started)

### Defining abilities
Now we can start to allow things. We call these allowed things `abilities`. To allow reading posts we can e.g. do this:
```ts
abilityBuilder.posts.allow("read");
```
This example assumes that our database has a posts table set up. Now everyone can read posts. Thats ok for simple applications but most of the time we want to allow access based on certain conditions being met. To do this, we also can add a more restrictive ability. E.g. if we only want to allow reading posts we could add a `published` boolean to our database model and then define our ability around that column:
```ts
abilityBuilder.posts.allow("read").when({
  where: eq(schema.posts.published, true),
});
```
The `when` call accepts a variety of restrictions which have different effects. E.g. you could also set a limit on how many results can be queried at a time. The accepted type is the same as the drizzle query api (e.g. the `findMany` call) which will be relevant later.

#### Dynamic abilities
Most of the time we want to allow things based on who the user is. If they are logged in they should be able to change their username. But only theirs, not the ones of any other users. For this, abilities allow for conditions based on the call context of a request. To use this, we need to create a context callback when initiating rumble first:
```ts
const { abilityBuilder, schemaBuilder, yoga, implementDefaultObject } =
  rumble({
    db,
    // the type of the request parameter may vary based on the HTTP library you are using.
    context(request) {
      // here you could access the cookies of the 
      // request object and extract the user ID or some
      // other form of permissions
      return {
        userId: 2, // we mock this for now
      };
    },
  });
```
we now can use the data from the request context in our abilities:
```ts
abilityBuilder.users
  .allow(["read", "update", "delete"])
  .when(({ userId }) => ({ where: eq(schema.users.id, userId) }));

```

### Defining objects
Pothos, the underlying GraphQL schema builder rumble uses needs the schema of the objects which can be returned, defined, before we can use them. Therefore we will define those first:
> If this is unfamiliar to you, please read through the pothos docs, especially the page on the [drizzle plugin](https://pothos-graphql.dev/docs/plugins/drizzle)
```ts
const PostRef = schemaBuilder.drizzleObject("posts", {
  name: "Post",
  fields: (t) => ({
    id: t.exposeInt("id"),
    content: t.exposeString("content"),
    author: t.relation("author", {
      // this is how you can apply the above abilities to the queries
      query: (_args, ctx) => ctx.abilities.users.filter("read"),
    }),
  }),
});
```
In the above object definition we tell pothos to expose the id and content so the fields will be just passed along from out database results and we define a relation to the posts author. We also restrict which author can be read. If the user which sends this request is not the author of a post, they cannot see the author and the request will fail. The `ctx.abilities.users.filter("read")` call simply injects the filter we defined in the abilities earlier and therefore restricts what can be returned.

#### Automatic object implementation
Since this can get a little extensive, especially for large models, rumble offers the `implementDefaultObject` helper. This does all of the above and will simply expose all fields and relations but with the ability restrictions applied.
```ts
const UserRef = implementDefaultObject({
  name: "User",
  tableName: "users",
});
```

#### Automatic arg implementation
rumble also supports automatically implementing basic filtering args. Those currently only allow for equality filtering for each field. E.g. the user can pass an email or an id and retrieve only results matching these for equality. Implementation works like this
```ts
const {
  // the input arg type, here we rename it to UserWhere
  inputType: UserWhere,
  // since drizzle wants proper instantiated filter clauses with `eq` calls and references to each field
  //  we need a transformer function which converts the object received from gql to a drizzle filter
  transformArgumentToQueryCondition: transformUserWhere,
} = implementWhereArg({
  // for which table to implement this
  tableName: "users",
});
```
usage of the above argument type may look like this. This query will return all users which the currently logged in user, according to our defined abilities, is allowed to see AND which match the passed filter arguments.
```ts
schemaBuilder.queryFields((t) => {
  return {
    findManyUsers: t.drizzleField({
      type: [UserRef],
      args: {
        // here we set our default type as type for the where argument
        where: t.arg({ type: UserWhere }),
      },
      resolve: (query, root, args, ctx, info) => {
        return db.query.users.findMany(
          query(
            ctx.abilities.users.filter("read", 
            // this additional object offers temporarily injecting additional filters to our existing ability filters
            {
              // the inject field allows for temp, this time only filters to be added to our ability filters. They will only be applied for this specific call.
              inject: { 
                // where conditions which are injected will be applied with an AND rather than an OR so the injected filter will further restrict the existing restrictions rather than expanding them
                where: transformUserWhere(args.where) },
            })
          )
        );
      },
    }),
  };
});
```

### Defining queries and mutations
Now we can define some things you can do. Again we use pothos for that. So please refer to [the docs](https://pothos-graphql.dev/docs/plugins/drizzle) if something is unclear.
```ts
schemaBuilder.queryFields((t) => {
  return {
    findManyUsers: t.drizzleField({
      type: [UserRef],
      resolve: (query, root, args, ctx, info) => {
        return db.query.users.findMany({
          ...query,
          // this is how we can apply the abilities to the request
          ...ctx.abilities.users.filter("read"),
        });
      },
    }),
  };
});

schemaBuilder.queryFields((t) => {
  return {
    findManyPosts: t.drizzleField({
      type: [PostRef],
      resolve: (query, root, args, ctx, info) => {
        return db.query.posts.findMany({
          ...query,
          ...ctx.abilities.posts.filter("read"),
        });
      },
    }),
  };
});

import {
  assertFindFirstExists,
  assertFirstEntryExists,
} from "@m1212e/rumble";
schemaBuilder.queryFields((t) => {
  return {
    findFirstUser: t.drizzleField({
      type: UserRef,
      resolve: (query, root, args, ctx, info) => {
        return (
          db.query.users
            .findFirst({
              ...query,
              // again, here we apply the abilities from above
              where: ctx.abilities.users.filter("read").where,
            })
            // note that we need to manually raise an error if the value is not found
            // since there is a type mismatch between GraphQL and the drizzle query result. 
            .then(assertFindFirstExists)
        );
      },
    }),
  };
});
```
A mutation could look like this:
```ts
schemaBuilder.mutationFields((t) => {
  return {
    updateUsername: t.drizzleField({
      type: UserRef,
      args: {
        userId: t.arg.int({ required: true }),
        newName: t.arg.string({ required: true }),
      },
      resolve: (query, root, args, ctx, info) => {
        return (
          db
            .update(schema.users)
            .set({
              name: args.newName,
            })
            .where(
              and(
                eq(schema.users.id, args.userId),
                ctx.abilities.users.filter("update").where
              )
            )
            .returning({ id: schema.users.id, name: schema.users.name })
            // note the different error mapper
            .then(assertFirstEntryExists)
        );
      },
    }),
  };
});
```