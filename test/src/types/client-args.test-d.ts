/**
 * Type-level tests for the `__args` of the generated client's selections, checked by
 * `tsc --noEmit`. A field whose arguments are all optional is generated as `(p?: A) => X`; its
 * `__args` used to go unchecked, so a misspelled or mistyped argument only failed at runtime.
 */

import type { makeSubscription } from "../../../lib/client/subscription";
import type { QueryableObjectFromGeneratedTypes } from "../../../lib/client/types";

type Kind = "NATION" | "CUSTOM";

// The shapes the client generator writes
type Item = {
  id: string;
  name: string;
  children: (p?: { where?: { name?: string | null } | null }) => Item[];
  parent: () => Item | null;
  label: (p: { locale: string }) => string;
};

type Query = {
  items: (p?: {
    limit?: number | null;
    where?: { kind?: Kind | null } | null;
  }) => Item[];
  item: (p: { id: string }) => Item;
  latest: () => Item;
  count: (p?: { where?: { kind?: Kind | null } | null }) => number;
};

declare const query: QueryableObjectFromGeneratedTypes<Query, false>;
declare const subscription: ReturnType<typeof makeSubscription<Query>>;

// --- optional arguments: may be left out, are checked when given ---

query.items({ id: true });
query.items({ __args: { limit: 3, where: { kind: "NATION" } }, id: true });
// @ts-expect-error a misspelled argument
query.items({ __args: { limt: 3 }, id: true });
// @ts-expect-error a mistyped argument
query.items({ __args: { limit: "3" }, id: true });
// @ts-expect-error an enum filter takes the value itself, not an operator object
query.items({ __args: { where: { kind: { in: ["NATION"] } } }, id: true });

subscription.items({ id: true });
subscription.items({ __args: { limit: 3 }, id: true });
// @ts-expect-error a misspelled argument
subscription.items({ __args: { limt: 3 }, id: true });

// --- required arguments stay required ---

query.item({ __args: { id: "1" }, name: true });
// @ts-expect-error the id is required
query.item({ name: true });
// @ts-expect-error a mistyped argument
query.item({ __args: { id: 1 }, name: true });

// --- fields without arguments take none ---

query.latest({ id: true });

// --- relations: optional arguments are checked there too ---

query.items({ id: true, children: { id: true } });
query.items({
  id: true,
  children: { __args: { where: { name: "a" } }, id: true },
});
query.items({
  id: true,
  // @ts-expect-error a misspelled argument of a relation
  children: { __args: { where: { nme: "a" } }, id: true },
});
query.items({ id: true, parent: { name: true } });
query.items({ id: true, label: { __args: { locale: "de" } } });
// @ts-expect-error a scalar field's required arguments
query.items({ id: true, label: true });

// --- a scalar result: the arguments are the whole input ---

query.count({ __args: { where: { kind: "CUSTOM" } } });
// @ts-expect-error a misspelled argument
query.count({ __args: { wher: { kind: "CUSTOM" } } });
