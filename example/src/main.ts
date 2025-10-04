import { createServer } from "node:http";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  assertFindFirstExists,
  assertFirstEntryExists,
  mapNullFieldsToUndefined,
  rumble,
} from "../../lib";
import { mergeFilters } from "../../lib/helpers/mergeFilters";
import { relations } from "./db/relations";
import * as schema from "./db/schema";

/*

  To use rumble, you first need to define a drizzle database schema and instance.
  If you are unfamiliar with this, please follow the excellent getting started guide
  in the drizzle docs: https://orm.drizzle.team/docs/get-started

  For this example setup there is a simple data seed defined at ./db/seed.ts

*/

export const db = drizzle(
  "postgres://postgres:postgres@localhost:5432/postgres",
  {
    relations,
    schema,
  },
);

// console.log(db._.schema);
// console.log(db._.relations);

/*

  Next, we can create a rumble instance. The creator returns a set of functions which you
  can use to define your objects, queries and mutations.

*/

const {
  abilityBuilder,
  schemaBuilder,
  whereArg,
  object,
  query,
  pubsub,
  createYoga,
  clientCreator,
} = rumble({
  // here we pass the db instance from above
  db,
  // this is how we can define a context callback
  // it takes a request object as an argument and returns the objects you want in the request context
  // similar to the context callback in express or similar frameworks
  // the type of the request parameter may vary based on the HTTP library you are using
  context(_request) {
    return {
      // for our usecase we simply mock a user ID to be set in the context
      // this will allow us to perform permission checks based on who the user is
      userId: 2,
    };
  },
  // in case you want to allow searching via string in the helper implementations
  // search: {
  // 	enabled: true,
  // },
});

/*

  Next we will define some abilities. Abilities are things which users are allowed to do.
  They consist of an action and, optionally, a condition.

  You can imagine abilities as an instruction to rumble: If this is the case, allow that.
  You can define as many as you want. Rumble will collect and track them to slowly build
  your permissions model which we can later apply to things which happen in our app.

*/

// users can edit themselves
abilityBuilder.users.allow(["read", "update", "delete"]).when(({ userId }) => ({
  where: {
    id: userId,
  },
}));

// everyone can read posts
abilityBuilder.posts.allow("read");

// or define a static condition
// abilityBuilder.posts.allow("read").when({
//   where: {
//     published: true,
//   },
// });

// only the author can update posts
abilityBuilder.posts.allow(["update", "delete"]).when(({ userId }) => ({
  where: {
    authorId: userId,
  },
}));

// a hypothetical more elaborate example
abilityBuilder.posts.allow(["update", "delete"]).when(({ userId }) => {
  // we could do some complex checks and calculations here and want to do various things based on the outcome:
  if (userId === 1) {
    return {
      where: {
        authorId: userId,
      },
    }; // we can return a standard ability which allows things under a specific condition
  }
  if (userId === 2) {
    return "allow"; // we can return a wildcard, which allows everything
  }
  return undefined; // we can return nothing, which does not allow anything
});

// in case you need to apply more complex filters or need async checks you can use the application level filters
// these are function which run after the database query has completed and can be used to do additional filtering
// on the results. Simply return what the user is allowed to see and rumble will take care of the rest
abilityBuilder.posts.filter("read").by(({ context: _context, entities }) => {
  // await someAsyncCheck()
  // we could apply filters here
  return entities;
});

/*

  Next we need to define the objects shape which will be returned by our queries and mutations.
  We use pothos under the hood to define our graphql schema. It is integrated with the drizzle plugin.
  If you are unfamiliar with pothos, please refer to the docs: https://pothos-graphql.dev/docs/plugins/drizzle
  Rumble creates a schema builder for you which you can use to define your objects, queries and mutations as
  you would with a regular schema builder instance.

 */

// we define the schema of the post object so we can later use it in our queries as a return type
const PostRef = schemaBuilder.drizzleObject("posts", {
  name: "Post",
  // this is how you can apply application level filter in manual object definitions
  // the helpers will do this for you automatically
  applyFilters: abilityBuilder._.registeredFilters({
    action: "read",
    table: "posts",
  }),
  fields: (t) => ({
    id: t.exposeInt("id"),
    content: t.exposeString("content", { nullable: false }),
    author: t.relation("author", {
      // this is how you can apply the above abilities to the queries
      // you define the action you want the filters for by passing it to the filter call
      query: (_args, ctx) => ctx.abilities.users.filter("read").query.single,
    }),
  }),
});

/*

  Since this might get a bit verbose, rumble offers a helper for defining default object implementations.
  It will expose all fields and relations but apply the above abilities to the queries so you don't have
  to worry about data getting returned which the caller should not be able to fetch.

 */

const UserRef = object({
  // name of the table you want to implement ("posts" in the above example)
  table: "users",
  // optionally specify the name of the object ("Post" in the above example)
  refName: "User",
  // optionally, we can extend this with some custom fields (you can also overwrite existing fields in case you need to change default behavior)
  adjust(t) {
    return {
      somethingElse: t.field({
        type: "String",
        args: {
          amount: t.arg.int({ required: true }),
        },
        resolve: (parent, args, _context, _info) =>
          `Hello ${parent.name}, you have provided the number: ${args.amount}`,
      }),
    };
  },
});

/*

  Now we need a way to fetch the users and posts from the database.
  We can implement the queries ourselves or use the provided helpers, its up to you.
  Manual implementation with the pothos schema builder instance would look something like this:

*/

schemaBuilder.queryFields((t) => {
  return {
    posts: t.drizzleField({
      type: [PostRef],
      resolve: (query, _root, _args, ctx, _info) => {
        return db.query.posts.findMany(
          // here we again apply our filters based on the defined abilities
          query(ctx.abilities.posts.filter("read").query.many),
        );
      },
    }),
  };
});

/*

  In case you want to allow filtering the posts returned by the above query, you would need to
  add an arg object to the query definition. You can implement this yourself or use the provided
  helper which will automatically create a filter arg for you. See https://pothos-graphql.dev/docs/guide/args
  and https://pothos-graphql.dev/docs/guide/inputs for more information for manual implementation.
  The rumble helper can implement some filters for you:

 */

const PostWhere = whereArg({
  // for which table to implement this
  table: "posts",
});
// there is also an orderArg which you can use to apply 'orderBy' just as you can do with 'where'

// now we can use this in a query
schemaBuilder.queryFields((t) => {
  return {
    postsFiltered: t.drizzleField({
      type: [PostRef],
      args: {
        // here we set our generated type as type for the where argument
        where: t.arg({ type: PostWhere }),
      },
      resolve: (query, _root, args, ctx, _info) => {
        // a helper to map null fields to undefined in any object
        const mappedArgs = mapNullFieldsToUndefined(args);
        return db.query.posts.findMany(
          query(
            ctx.abilities.posts
              .filter("read")
              // merge is a helper to merge multiple filter objects into one
              // so we can easily apply both the permissions filter and the user provided filter
              // just for this one query call
              .merge({
                where: mappedArgs.where,
              }).query.many,
          ),
        );
      },
    }),
  };
});

/*

  We can also implement the READ queries by using the provided helper.
  The below helper will offer findFirst and findMany implementations
  with permissions and filtering applied.

  NOTE: Before you call a query for an object, you need to define it first.
  Make sure you either do that manually or use the `object` helper as shown above.

*/

query({
  table: "users",
});

object({
  table: "comments",
});
query({
  table: "comments",
});

/*

  Lastly, we want to implement the mutations so we can actually edit some data.
  We can use the schemaBuilder to do that.

  NOTE: The below example uses the assertFirstEntryExists mapper.
  rumble offers two helpers to map drizzle responses to graphql compatible responses:

  `assertFirstEntryExists` - throws an error if the response does not contain a single entry
  `assertFindFirstExists` - makes the result of a findFirst query compatible with graphql. Also throws if not present.
*/

// OPTIONAL: If you want to use graphql subscriptions, you can use the pubsub helper
// this makes notifying subscribers easier. The rumble helpers all support subscriptions
// right out of the box, so all subscriptions will automatically get notified if necessary
// the only thing you have to do is to call the pubsub helper with the table name
// and embed the helper into your mutations
const { updated: updatedUser, created: createdUser } = pubsub({
  table: "users",
});

schemaBuilder.mutationFields((t) => {
  return {
    updateUsername: t.drizzleField({
      type: UserRef,
      args: {
        userId: t.arg.int({ required: true }),
        newName: t.arg.string({ required: true }),
      },
      resolve: async (query, _root, args, ctx, _info) => {
        // for update mutations, rumble exports the 'mapNullFieldsToUndefined' helper
        // which might become handy in some situtations

        await db
          .update(schema.users)
          .set({
            name: args.newName,
          })
          .where(
            and(
              eq(schema.users.id, args.userId),
              ctx.abilities.users.filter("update").sql.where,
            ),
          );

        // this notifies all subscribers that the user has been updated
        updatedUser(args.userId);

        return (
          db.query.users
            .findFirst(
              query(
                mergeFilters(ctx.abilities.users.filter("read").query.single, {
                  where: { id: args.userId },
                }),
              ),
            )
            // this maps the db response to a graphql response
            .then(assertFindFirstExists)
        );
      },
    }),
  };
});

schemaBuilder.mutationFields((t) => {
  return {
    addUser: t.drizzleField({
      type: UserRef,
      args: {
        id: t.arg.int({ required: true }),
        name: t.arg.string({ required: true }),
      },
      resolve: async (query, _root, args, ctx, _info) => {
        // TODO: check if the user is allowed to add a user

        const newUser = await db
          .insert(schema.users)
          .values({
            id: args.id,
            name: args.name,
          })
          .returning({
            id: schema.users.id,
          })
          .then(assertFirstEntryExists);

        // this notifies all subscribers that a user has been added
        createdUser();

        return (
          db.query.users
            // run the db query
            .findFirst(
              // inject all graphql selections which ought to be queried from the db according to the gql request
              query(
                // merge multiple filter objects which should be applied to the query
                mergeFilters(
                  {
                    // only retrieve the newly created user
                    where: { id: newUser.id },
                  },
                  // only retrieve the user if the caller is allowed to read it
                  ctx.abilities.users.filter("read").query.single,
                ),
              ),
            )
            .then(assertFindFirstExists)
        );
      },
    }),
  };
});

// /*

//   Finally, we can start the server. We use graphql-yoga under the hood. It allows for
//   a very simple and easy to use GraphQL API and is compatible with many HTTP libraries and frameworks.

// */

// when we are done defining the objects, queries and mutations,
// we can start the server
const server = createServer(createYoga());
server.listen(3000, () => {
  console.info("Visit http://localhost:3000/graphql");
});

// if you also need a REST API built from your GraphQL API, you can use 'createSofa()' instead or in addition

// Making calls to the API

// this can run on the dev machine to create a client for
// api consumption. Make sure to call this after registering
// all objects, queries and mutations and only in dev mode
await clientCreator({
  rumbleImportPath: "../../../lib/index",
  outputPath: "./example/src/generated-client",
  apiUrl: "http://localhost:3000/graphql",
});

// which then can be used like this:
// import { client } from "./generated-client/client";

// const r1 = client.liveQuery.users({
// 	id: true,
// 	name: true,
// });

// r1.subscribe((s) => s?.at(0));

// const a = client.subscribe.users({
// 	id: true,
// 	name: true,
// });

// a.subscribe((s) => s.at(0));
