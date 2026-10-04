import type DataLoader from "dataloader";
import { requestStateKey } from "./keys";

/**
 * The state of a single request, kept on its abilities. Nothing about a
 * request is stored on the rows or outside of it, rows may be shared across
 * requests (e.g. by a cache).
 */
export type RequestState<Action extends string> = {
  /** selected next to the column flag, so flags of other requests are ignored */
  id: number;
  /** the rows masked in this request and whether their primary key is hidden */
  masked: WeakMap<object, boolean>;
  /** per table the actions rows were masked with, reloads apply them */
  actions: Map<string, Set<Action>>;
  /** per runtime filter the loader batching its calls */
  filterLoaders: Map<object, DataLoader<any, any>>;
};

let lastRequestId = 0;

export function createRequestState<
  Action extends string,
>(): RequestState<Action> {
  // stays a signed 32 bit integer, which every dialect selects as a number
  lastRequestId = (lastRequestId % 2 ** 31) + 1;
  return {
    id: lastRequestId,
    // weak, a subscription's request lives as long as the subscription
    masked: new WeakMap(),
    actions: new Map(),
    filterLoaders: new Map(),
  };
}

export function attachRequestState(
  abilities: object,
  state: RequestState<any>,
) {
  // a symbol, so it can't collide with a table name
  Object.defineProperty(abilities, requestStateKey, { value: state });
}

export function requestStateOf<Action extends string>(
  abilities: object | undefined,
) {
  return (abilities as any)?.[requestStateKey] as
    | RequestState<Action>
    | undefined;
}
