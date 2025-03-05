# rumble
rumble is a combined ability and graphql builder built around [drizzle](https://orm.drizzle.team/docs/overview) and [pothos](https://pothos-graphql.dev/docs/plugins/drizzle), inspired by [CASL](https://casl.js.org/v6/en/). It takes much of the required configuration off your shoulders and makes creating a GraphQL server very easy!

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

const { abilityBuilder } = rumble({ db });
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

### Helpers
rumble offers a set of helpers which make it easy to implement your api. Please see the [full example code](./example) for a more extensive demonstration of rumbles features.

### Subscriptions
rumble supports subscriptions right out of the box. When using the rumble helpers, you basically get subscriptions for free, no additional work required!