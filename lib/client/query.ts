import type { Client } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeGraphQLQueryRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeQuery<
  Query extends Record<string, any>,
  ForceReactivity extends boolean = false,
>({
  urqlClient,
  forceReactivity,
  schema,
  autoIncludeIdField,
}: {
  urqlClient: Client;
  forceReactivity?: ForceReactivity;
  schema: IntrospectionQuery;
  autoIncludeIdField?: string;
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
            autoIncludeIdField,
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Query, ForceReactivity>;
}
