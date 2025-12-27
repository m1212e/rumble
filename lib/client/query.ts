import type { Client } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeGraphQLQueryRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeQuery<
  Query extends Record<string, any>,
  ForceReactivity extends boolean,
>({
  urqlClient,
  forceReactivity,
  schema,
}: {
  urqlClient: Client;
  forceReactivity?: ForceReactivity;
  schema: IntrospectionQuery;
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
            schema,
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Query, ForceReactivity>;
}
