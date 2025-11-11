import type { Client } from "@urql/core";
import { argsKey, makeGraphQLSubscription } from "./request";
import type {
  ApplySelection,
  ObjectFieldSelection,
  Subscribeable,
} from "./types";
import type { UnArray } from "./utilTypes";

export function makeSubscription<Subscription extends Record<string, any>>({
  urqlClient,
}: {
  urqlClient: Client;
}) {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        return (input: Record<string, any>) => {
          return makeGraphQLSubscription({
            subscriptionName: prop as string,
            input,
            client: urqlClient,
          });
        };
      },
    },
  ) as SubscriptionObject<Subscription>;
}

// TODO use the query util types

export type SubscriptionObject<Q> = {
  [Key in keyof Q]: QueryableObjectField<Q[Key]>;
};

type QueryableObjectField<T> = T extends (
  p: infer QueryArgs,
) => infer QueryResponse
  ? <
      Selected extends QueryArgs extends Record<string, any>
        ? ObjectFieldSelection<UnArray<NonNullable<QueryResponse>>> & {
            [argsKey]: QueryArgs;
          }
        : ObjectFieldSelection<UnArray<NonNullable<QueryResponse>>>,
    >(
      s: Selected,
    ) => QueryResponse extends null
      ? Subscribeable<
          NonNullable<QueryResponse> extends Array<any>
            ? ApplySelection<UnArray<NonNullable<QueryResponse>>, Selected>[]
            : ApplySelection<UnArray<NonNullable<QueryResponse>>, Selected>
        > | null
      : Subscribeable<
          QueryResponse extends Array<any>
            ? ApplySelection<UnArray<QueryResponse>, Selected>[]
            : ApplySelection<UnArray<QueryResponse>, Selected>
        >
  : Subscribeable<T>;
