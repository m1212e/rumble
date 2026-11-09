import type { Client } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeGraphQLSubscriptionRequest } from "./request";
import type {
  ApplySelection,
  ObjectFieldSelection,
  Subscribeable,
} from "./types";
import type { ArgsSelection, UnArray } from "./utilTypes";

export function makeSubscription<
  Subscription extends Record<string, any>,
  IdField extends string = never,
>({
  urqlClient,
  schema,
  autoIncludeIdField,
}: {
  urqlClient: Client;
  schema: IntrospectionQuery;
  // any string, so a call naming its type arguments without the id field still compiles
  autoIncludeIdField?: IdField | string;
}) {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        return (input: Record<string, any>) => {
          return makeGraphQLSubscriptionRequest({
            subscriptionName: prop as string,
            input,
            client: urqlClient,
            schema,
            autoIncludeIdField,
          });
        };
      },
    },
  ) as SubscriptionObject<Subscription, IdField>;
}

// TODO use the query util types

type SubscriptionObject<Q, IdField extends string> = {
  [Key in keyof Q]: QueryableObjectField<Q[Key], IdField>;
};

type QueryableObjectField<T, IdField extends string> = T extends (
  p: infer QueryArgs,
) => infer QueryResponse
  ? <
      Selected extends ObjectFieldSelection<
        UnArray<NonNullable<QueryResponse>>
      > &
        ArgsSelection<QueryArgs>,
    >(
      s: Selected,
    ) => QueryResponse extends null
      ? Subscribeable<
          NonNullable<QueryResponse> extends Array<any>
            ? ApplySelection<
                UnArray<NonNullable<QueryResponse>>,
                Selected,
                IdField
              >[]
            : ApplySelection<
                UnArray<NonNullable<QueryResponse>>,
                Selected,
                IdField
              >
        > | null
      : Subscribeable<
          QueryResponse extends Array<any>
            ? ApplySelection<UnArray<QueryResponse>, Selected, IdField>[]
            : ApplySelection<UnArray<QueryResponse>, Selected, IdField>
        >
  : Subscribeable<T>;
