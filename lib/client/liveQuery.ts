import type { Client } from "@urql/core";
import { makeGraphQLQueryRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeLiveQuery<
  Query extends Record<string, any>,
  ForceReactivity extends boolean,
>({
  urqlClient,
  availableSubscriptions,
  forceReactivity,
}: {
  urqlClient: Client;
  availableSubscriptions: Set<string>;
  forceReactivity?: ForceReactivity;
}) {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        return (input: Record<string, any>) => {
          return makeGraphQLQueryRequest({
            queryName: prop as string,
            input,
            client: urqlClient,
            enableSubscription: availableSubscriptions.has(prop as string),
            forceReactivity,
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Query, ForceReactivity>;
}
