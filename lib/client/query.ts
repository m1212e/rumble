import type { Client, CombinedError } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeGraphQLQueryRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeQuery<
  Query extends Record<string, any>,
  ForceReactivity extends boolean = false,
  IdField extends string = never,
>({
  urqlClient,
  forceReactivity,
  schema,
  autoIncludeIdField,
  onError,
}: {
  urqlClient: Client;
  forceReactivity?: ForceReactivity;
  schema: IntrospectionQuery;
  // any string, so a call naming its type arguments without the id field still compiles
  autoIncludeIdField?: IdField | string;
  /** Hears every error result a live result skips, keeping its last data. */
  onError?: (error: CombinedError) => void;
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
            onError,
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Query, ForceReactivity, IdField>;
}
