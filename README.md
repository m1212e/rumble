# rumble
rumble is a combined ability and graphql builder built around [drizzle](https://orm.drizzle.team/docs/overview) and [pothos](https://pothos-graphql.dev/docs/plugins/drizzle), inspired by [CASL](https://casl.js.org/v6/en/). It takes much of the required configuration off your shoulders and makes creating a GraphQL (or event REST via [SOFA](https://the-guild.dev/graphql/sofa-api)) api very easy!

> Please note that drizzle hasn't reached a full stable release yet and, as shown in the warning [here](https://pothos-graphql.dev/docs/plugins/drizzle), this is not stable yet.

> Using rumble and reading these docs requires some basic knowledge about the above mentioned tools. If you feel stuck, please make sure to familiarize yourself with those first! Especially familiarity with pothos and its drizzle plugin are very helpful!

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
import { rumble } from "@m1212e/rumble";

export const db = drizzle(
 "postgres://postgres:postgres@localhost:5432/postgres",
 { schema }
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
	applyFilters: abilityBuilder.registeredFilters.posts.read,
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

### arg
`arg` is a helper to implement query arguments for filtering the results of a query for certain results. In many cases you would implement arguments for a query with something as `matchUsername: t.arg.string()` which is supposed to restrict the query to users which have that username. The arg helper implements such a filter tailored to the specific entity which you then can directly pass on to the database query.
```ts
const WhereArgs = arg({
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
      ctx.abilities.users.filter("read", {
      // we can inject one time filters into the permission filter
       inject: {
        where: args.where,
       },
      }).query.many,
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

## Running the server
In case you directly want to run a server from your rumble instance, you can do so by using the `createYoga` function. It returns a graphql `yoga` instance which can be used to provide a graphql api in [a multitude of ways](https://the-guild.dev/graphql/yoga-server/docs/integrations/z-other-environments).
```ts
import { createServer } from "node:http";
const server = createServer(createYoga());
server.listen(3000, () => {
 console.info("Visit http://localhost:3000/graphql");
});

```
