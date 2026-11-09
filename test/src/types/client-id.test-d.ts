/**
 * Type-level tests for what the generated client's results carry, checked by `tsc --noEmit`: the
 * field `autoIncludeIdField` adds at runtime, and what `subscribe` answers.
 */

import type { makeSubscription } from "../../../lib/client/subscription";
import type { QueryableObjectFromGeneratedTypes } from "../../../lib/client/types";

type Tag = { label: string };

type Item = {
  id: string;
  name: string;
  children: (p?: { limit?: number | null }) => Item[];
  tag: () => Tag | null;
};

type Query = {
  items: (p?: { limit?: number | null }) => Item[];
};

declare const withId: QueryableObjectFromGeneratedTypes<Query, false, "id">;
declare const withoutId: QueryableObjectFromGeneratedTypes<Query, false>;
declare const subscription: ReturnType<typeof makeSubscription<Query, "id">>;

// --- the id field is in the result without being selected, all the way down ---

const items = await withId.items({ name: true, children: { name: true } });
items[0]?.id satisfies string | undefined;
items[0]?.children[0]?.id satisfies string | undefined;

// a type without the field gets none
const tagged = await withId.items({ tag: { label: true } });
// @ts-expect-error a tag has no id
tagged[0]?.tag?.id;

subscription.items({ name: true }).subscribe((value) => {
  value[0]?.id satisfies string | undefined;
});

// --- without auto included ids, only what was selected ---

const plain = await withoutId.items({ name: true });
// @ts-expect-error the id was not selected
plain[0]?.id;

// --- subscribe answers a function that also carries unsubscribe ---

const unsubscribe = withId.items({ name: true }).subscribe(() => {});
unsubscribe();
unsubscribe.unsubscribe();

// --- the field comes from the type arguments, and the option takes any string ---

import type { Client } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeLiveQuery } from "../../../lib/client/liveQuery";

declare const urqlClient: Client;
declare const schema: IntrospectionQuery;
const options = {
  urqlClient,
  schema,
  availableSubscriptions: new Set<string>(),
};

const named = makeLiveQuery<Query, false, "id">({
  ...options,
  autoIncludeIdField: "id",
});
(await named.items({ name: true }))[0]?.id satisfies string | undefined;

const autoIncludeIdField: string = "id";
const explicit = makeLiveQuery<Query>({ ...options, autoIncludeIdField });
// @ts-expect-error without the field among the type arguments, the types do not know it
(await explicit.items({ name: true }))[0]?.id;
