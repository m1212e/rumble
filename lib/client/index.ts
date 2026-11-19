// Declarations of the generated `client` and of code returning query results name these types.
// Unexported, TypeScript inlines them: the `make…` return types over the whole schema, which never
// finishes (TS7's incremental check emits declarations of every changed file), and every result's
// data three times over.

export { makeLiveQuery } from "./liveQuery";
export { makeMutation } from "./mutation";
export { nativeDateExchange } from "./nativeDateExchange";
export { makeQuery } from "./query";
export type { SubscriptionObject } from "./subscription";
export { makeSubscription } from "./subscription";
export type {
  QueryableObjectFromGeneratedTypes,
  QueryResult,
  Subscribeable,
  Unsubscriber,
} from "./types";
