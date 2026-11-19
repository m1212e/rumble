/**
 * The return types of the `make…` helpers and of their fields must stay importable from the client
 * entry. A declaration emit of the generated `client` names them; when it cannot, it inlines them
 * over the whole schema and runs out of memory.
 */

import type {
  makeLiveQuery,
  makeMutation,
  makeQuery,
  makeSubscription,
  QueryableObjectFromGeneratedTypes,
  QueryResult,
  Subscribeable,
  SubscriptionObject,
  Unsubscriber,
} from "../../../lib/client/index";

type Query = { item: (p: { id: string }) => { id: string } };

declare const liveQuery: ReturnType<typeof makeLiveQuery<Query, false, "id">>;
declare const query: ReturnType<typeof makeQuery<Query, false, "id">>;
declare const mutation: ReturnType<typeof makeMutation<Query, "id">>;
declare const subscription: ReturnType<typeof makeSubscription<Query, "id">>;

liveQuery satisfies QueryableObjectFromGeneratedTypes<Query, false, "id">;
query satisfies QueryableObjectFromGeneratedTypes<Query, false, "id">;
mutation satisfies QueryableObjectFromGeneratedTypes<Query, false, "id">;
subscription satisfies SubscriptionObject<Query, "id">;

const item = query.item({ __args: { id: "1" }, id: true });
item satisfies QueryResult<{ id: string }, false>;
item satisfies Subscribeable<{ id: string } | undefined>;
item.subscribe(() => {}) satisfies Unsubscriber;
