import type { Client } from "@urql/core";
import { makeGraphQLQueryRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeQuery<
  Query extends Record<string, any>,
  ForceReactivity extends boolean,
>({
  urqlClient,
  forceReactivity,
}: {
  urqlClient: Client;
  forceReactivity?: ForceReactivity;
}) {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        return (input?: Record<string, any>) => {
          return makeGraphQLQueryRequest({
            queryName: prop as string,
            input,
            client: urqlClient,
            enableSubscription: false,
            forceReactivity,
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Query, ForceReactivity>;
}
