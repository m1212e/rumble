# rumble
rumble is a combined ability and graphql builder built around [drizzle](https://orm.drizzle.team/docs/overview) and [pothos](https://pothos-graphql.dev/docs/plugins/drizzle), inspired by [CASL](https://casl.js.org/v6/en/). It takes much of the required configuration off your shoulders and makes creating a GraphQL (or event REST via [SOFA](https://the-guild.dev/graphql/sofa-api)) api very easy! Additionally it offers strong support for real time data via GraphQL subscriptions!

> Please note that drizzle hasn't reached a full stable release yet and, as shown in the warning [here](https://pothos-graphql.dev/docs/plugins/drizzle), this is not stable yet.

> Using rumble and reading these docs requires some basic knowledge about the above mentioned tools. If you feel stuck, please make sure to familiarize yourself with those first! Especially familiarity with pothos and its drizzle plugin are very helpful!

> rumble currently works best with postgres. Some features might not work with other databases.

> Comes with a fully TS based client to consume any GraphQL API. See the client docs at the end to learn about usage with rumble and independent usage with any GraphQL API.

## Getting started
The following example is an excerpt from the example setup you can find [here](./example). If you are interested in a real world app thats using rumble (and is still work in progress) please see [CHASE](https://github.com/DeutscheModelUnitedNations/munify-chase).

First, install rumble into your project:
```
bun add @m1212e/rumble
npm i @m1212e/rumble
```
then call the rumble creator:
```ts
import * as schema from "./db/schema";
import * as relations from "./db/relations";
import { rumble } from "@m1212e/rumble";

export const db = drizzle(
 "postgres://postgres:postgres@localhost:5432/postgres",
 { schema, relations }
);

const { abilityBuilder } = rumble({ db });
```
> If the creation of a drizzle instance with the schema definition seems unfamiliar to you, please see their excellent [getting started guide](https://orm.drizzle.team/docs/get-started)

The rumble creator returns some functions which you can use to implement your api. The concepts rumble uses are described in the following sections:

## Abilities
Abilities are the way you define who can do things in your app. You can imagine an ability as `a thing that is allowed`. Abilities can be very wide and applied in general or precisely and narrowly scoped to very specific conditions. You can create abilities with the `abilityBuilder` function returned from the rumble initiator. There are three kinds of abilities:

### Wildcard
Wildcard abilities allow everyone to do a thing. The `allow` call takes a single `action` or an array of `action` strings. You can customize the available actions when calling the rumble initializer.
```ts
// everyone can read posts
abilityBuilder.posts.allow("read");

// everyone can read and write posts
abilityBuilder.posts.allow(["read", "write"]);
```

### Condition Object
Condition object abilities allow a thing under a certain, fixed condition which does not change. __Note, that the object has the same type as a drizzle query call.__
```ts
// everyone can read published posts
abilityBuilder.posts.allow("read").when({
 where: { published: true },
});
```

### Condition Function
Condition functions are functions that return condition objects. They are called each time an evaluation takes place and can dynamically decide if something should be allowed or not. They receive the request context as a parameter to decide e.g. based on cookies or headers if something is allowed or not.
```ts
// only the author can update posts
abilityBuilder.posts
 .allow(["update", "delete"])
 .when(({ userId }) => ({ where: { authorId: userId } }));

```

### Application level filters
In some cases you can't implement all your checks via a database query filter. Say, for example, you want to query an external api which handles your authorization, before you return the data to the user. This can be done with application layer filters. They can be set very similar to abilities:
```ts
abilityBuilder.users.filter("read").by(({ context, entities }) => {
	// const allowed = await queryExternalAuthorizationService(context.user, entities);

	// we could filter the list to only return the entities the user is allowed to see
	// event mapping to prevent leakage of certain fields is possible
	return entities;
});
```
The default implementation helpers automatically respect and call the filters, if you set any. Filters work in addition to abilities. They run on the completed query, which in most cases has had an ability applied, hence abilities have higher priority than filters. If you need to apply a filter to a manually implemented object, please use the `applyFilters` config field as shown in the example project.


### Applying abilities
As you might have noticed, abilities resolve around drizzle query filters. This means, that we can use them to query the database with filters applied that directly restrict what the user is allowed to see, update and retrieve.
```ts
schemaBuilder.queryFields((t) => {
 return {
  posts: t.drizzleField({
   type: [PostRef],
   resolve: (query, root, args, ctx, info) => {
    return db.query.posts.findMany(
     // here we apply our filter
     query(ctx.abilities.posts.filter("read").query.many),
    );
   },
  }),
 };
});
```

> The `filter()` call returns an object with `query` and `sql` fields. Depending on if you are using the drizzle query or and SQL based API (like update or delete), you need to apply different filters. Same goes for the `query.many` and `query.single` fields.

#### Applying filters
Applying filters on objects is done automatically if you use the helpers. If you manually implement an object ref, you can use the `applyFilters` config field to ensure the filters run as expected:
```ts
const PostRef = schemaBuilder.drizzleObject("posts", {
	name: "Post",
	// apply the application level filters
	applyFilters: abilityBuilder._.registeredFilters({
    action: "read",
    table: "posts",
  }),
	fields: (t) => ({
...
```
To apply filters in a custom handler implementation, like e.g. your mutations, you can use the `applyFilters` helper exported by rumble to easily filter a list of entities.

## Context & Configuration
The `rumble` initiator offers various configuration options which you can pass. Most importantly, the `context` provider function which creates the request context that is passed to your abilities and resolvers.
```ts
rumble({
 db,
 context(request) {
  return {
   // here you could instead read some cookies or HTTP headers to retrieve an actual userId
   userId: 2,
  };
 },
});
```
> `rumble` offers more config options, use intellisense or take a look at [the rumble input type](lib/types/rumbleInput.ts) if you want to know more.

## Helpers
Rumble offers various helpers to make it easy and fast to implement your api. Ofcourse you can write your api by hand using the provided `schemaBuilder` from the rumble initiator, but since this might get repetitive, the provided helpers automate a lot of this work for you while also automatically applying the concepts of rumble directly into your api.

### whereArg
`whereArg` is a helper to implement query arguments for filtering the results of a query for certain results. In many cases you would implement arguments for a query with something as `matchUsername: t.arg.string()` which is supposed to restrict the query to users which have that username. The whereArg helper implements such a filter tailored to the specific entity which you then can directly pass on to the database query.
```ts
const WhereArgs = whereArg({
 table: "posts",
});

schemaBuilder.queryFields((t) => {
 return {
  postsFiltered: t.drizzleField({
   type: [PostRef],
   args: {
    // here we set our generated type as type for the where argument
    where: t.arg({ type: WhereArgs }),
   },
   resolve: (query, root, args, ctx, info) => {
    return db.query.posts.findMany(
     query(
      // here we apply the ability filter
      ctx.abilities.users.filter("read")
      // we can merge one time filters into the permission filter for this specific request
        .merge({ where: args.where }).query.many,
     ),
    );
   },
  }),
 };
});
```

### object
`object` is a helper to implement an object with relations. Don't worry about abilities, they are automatically applied. The helper returns the object reference which you can use in the rest of your api, for an example on how to use a type, see the above code snippet (`type: [PostRef],`).
```ts
const UserRef = object({
 table: "users",
});
```

### query
The `query` helper is even simpler. It implements a `findFirst` and `findMany` query for the specified entity named as singular and plural of the entities name.
```ts
query({
 table: "users",
});

```

### pubsub
In case you want to use subscriptions, `rumble` has got you covered! The rumble helpers all use the `smart subscriptions plugin` from `pothos`. The `pubsub` helper lets you easily hook into the subscription notification logic.
```ts
const { updated, created, removed } = pubsub({
 table: "users",
});
```
Now just call the functions whenever your application does the respective action and your subscriptions will get notified:
```ts
updateUsernameHandler() => {
  await db.updateTheUsername();
  // the pubsub function
  updated(user.id);
}
// or if creating
createUserHandler() => {
  await db.createTheUser();
  // the pubsub function
  created();
}
```
All `query` and `object` helper implementations will automatically update and work right out of the box, no additional config needed!

> The rumble initiator lets you configure the subscription notifiers in case you want to use an external service like redis for your pubsub notifications instead of the internal default one

### enum_
The `enum_` helper is a little different to the others, as it will get called internally automatically if another helpers like `object` or `arg` detects an enum field. In most cases you should be good without calling it manually but in case you would like to have a reference to an enum object, you can get it from this helper.
```ts
const enumRef = enum_({
 tsName: "moodEnum",
});
```
> The enum parameter allows other fields to be used to reference an enum. This is largely due to how this is used internally. Because of the way how drizzle handles enums, we are not able to provide type safety with enums. In case you actually need to use it, the above way is the recommended approach.

### Enable search
> Search is currently only supported in postgres!

rumble and its helpers offer out of the box search capabilities. You can activate this functionality by passing the `search` parameter to the `createRumble` function.
```ts
const rumble = createRumble({
  ...
  search: {
    enabled: true,
    threshold: 0.2, // optionally adjust this value to your needs
  },
});
```
This will add a search field to all list queries and many relations created by the rumble helper functions. E.g. if you have a `users` table with a `name` and `email` field, and use the `object` and `query` helpers to implement queries for this table, you will get a search argument like this:
```graphql
{
  users(limit: 10, search: "alice") {
    id
    name
    email
    search_distance
  }
}
```
Additionally, a search distance will be returned for each result if the search argument is used (null otherwise). The results are returned sorted by their distance with the best matching fields in the first place. The search will respect all text fields (IDs included) on the table, you always search for all text columns at once. Matches in multiple columns stack and therefore result in a better matching score. So if you search for "alice" and there is a user with the name "Alice" and an email "alice@example.com", the two matching columns will result in a better score than e.g. "al007@example.com"/"Alice".
> If you have abilities in place which prevent a caller from accessing certain columns, the search will not respect those columns to prevent leaking information.
#### Pro tip: Indexing
In case your table grows large, it can be a good idea to create an index to increase performance. Under the hood, searching uses the [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html#PGTRGM-INDEX) extension. To create indexes for our searchable columns, we can adjust our drizzle schema accordingly:
```ts
export const user = pgTable('user', {
    id: text()
      .$defaultFn(() => nanoid())
      .primaryKey(),
    email: text().notNull().unique(),
    name: text().notNull(),
  },
  (table) => [
    index('user_id_trgm')
      .using('gin', sql`${table.id} gin_trgm_ops`)
      .concurrently(),
    index('user_email_trgm')
      .using('gin', sql`${table.email} gin_trgm_ops`)
      .concurrently(),
    index('user_name_trgm')
      .using('gin', sql`${table.name} gin_trgm_ops`)
      .concurrently(),
  ],
);
```
> When deciding to create indexes for faster searches, ensure that you create them for all text based columns that exist in your table. This includes `text`, `char`, `varchar` and so on. Since rumble always searches all the text columns, it is recommended to create indexes for all text columns in your table, otherwise the search might not be as fast as possible.

In case you never started rumble with the search mode activated and you want to create the indexes in your migration, please ensure that the `pg_trgm` extension is installed and enabled in your database. You can do this by running the following SQL command:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```
rumble does this automatically on startup if the search feature is enabled, nonetheless it is recommended to include the extension installation in your migration scripts to ensure that the extension is available when you create the indexes which rely on it.

**What this means for you**: After creating the migration files containing the indexes the first time with the `drizzle-kit generate` command (or your respective migration tool), add the above SQL statement before any index creation inside that generated migration file. This will ensure that the extension is installed and enabled before the indexes that rely on it are created.

Another important aspect to consider when using indexes is that the PostgreSQL instance should be properly configured for optimal performance (e.g. the drive type you use might have an impact). This includes tuning settings such as `random_page_cost` and `effective_io_concurrency`. Please see [this quick writeup on the topic](https://blog.frehi.be/2025/07/28/tuning-postgresql-performance-for-ssd). If not done properly, your indexes might not be used as expected rendering them useless.

Please also note that `GIST` indexes are also supported by `pg_trgm` but will oftentimes not be useable for the sorting since a lot of columns are accumulated in the query which causes the query planner to not use them. Feel free to experiment with different index types and configurations to find the best fit for your specific use case.

### and more...
See [the example file](./example/src/main.ts) or clone it and let intellisense guide you. Rumble offers various other helpers which might become handy!

## Running the server
In case you directly want to run a server from your rumble instance, you can do so by using the `createYoga` function. It returns a graphql `yoga` instance which can be used to provide a graphql api in [a multitude of ways](https://the-guild.dev/graphql/yoga-server/docs/integrations/z-other-environments).
```ts
import { createServer } from "node:http";
const server = createServer(createYoga());
server.listen(3000, () => {
 console.info("Visit http://localhost:3000/graphql");
});

```

## Usage & client generation
You can use the GraphQL api with any client you like. However, rumble provides a generation api which can output a TypeScript client from a rumble instance. To perform a generation, use the exported function from your rumble instance like this:
```ts

const {	clientCreator } = rumble(...);

await clientCreator({
  // where should the client files be generated to
	outputPath: "./example/src/generated-client",
  // where will the client be able to reach your api
	apiUrl: "http://localhost:3000/graphql",

  // in case you do not want to specify a url yourself
  // or you would like to perform some customization
  // to the underlying urql client, you can set

  // useExternalUrqlClient: "../client"

  // to point to your custom client
});
```
> The client uses [urql](https://nearform.com/open-source/urql/docs/basics/core/) under the hood. If you would like more info on how the internals work, please see their docs.

This way of generating code is especially helpful in monorepos, where it is convenient to output client code when running the server during development. If you do not use a monorepo and want to decouple the generation process, see below.

> The generated client contains metadata about the schema to function properly. Depending on the project and schema, this might be quite large and will increase bundle size. Additionally, this can provide sensitive information about the structure of your system. If you are concerned about this, it is recommended to use a different client.


An example usage might look like this:
```ts
import { client } from "./generated-client/client";

const users = client.liveQuery.users({
	id: true,
	name: true,
});

users.subscribe((s) => s?.at(0));
```
Notice how the client offers `liveQuery` in addition to the traditional `query`, `mutation` and `subscription` operations. The live query is a hybrid query and subscription which basically performs a regular query and then checks if there is a subscription available with the same name (as it is the case when using the rumble query implementation helpers). In case there is one present, it will also subscribe. If no subscription with the same name can be found, it will perform a regular query.

If you would like to ensure that there is data present before subscribing to updates, you can await the result:

```ts
// this waits for the first value to arrive
const users = await client.liveQuery.users({
	id: true,
	name: true,
});

// this will guaranteed to have a value set
users.subscribe((s) => s?.at(0));

// you can directly access the values of an awaited result
console.log(users.firstName)
```
> As of `v0.16.12` the client has special support for the svelte reactive state system (runes). If you run a live query which deploys a subscription inside a svelte effect context, you will get reactivity without subscribing to anything right out of the box. Please see [here](https://github.com/DeutscheModelUnitedNations/munify-chase/blob/f70c4484a92551b564c70603ebfd48d5b8cac637/src/lib/api/customClient.ts#L12) and [here](https://github.com/DeutscheModelUnitedNations/munify-chase/blob/f70c4484a92551b564c70603ebfd48d5b8cac637/src/routes/app/(launcher)/%2Bpage.svelte#L9C9-L9C23) for real world examples.
### Alternative decoupled client generation
As an alternative to use the client generator with a fully instanciated rumble instance, you can also import the `generateFromSchema` function from rumble and pass it a standard `GraphQLSchema` object to generate the client:
```ts
import { generateFromSchema } from "@m1212e/rumble/client/generate";

await generateFromSchema({
  // a schema object: https://github.com/graphql/graphql-js/blob/60ae6c48b9c78332bf3d6036e7d931a3617d0674/src/type/schema.ts#L130
	schema: yourGraphQLSchemaObject
	outputPath: "./generated";
}) 
```
This might become handy in separate code bases for api and client.
