import type { Client } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeGraphQLMutationRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeMutation<Mutation extends Record<string, any>>({
  urqlClient,
  schema,
  autoIncludeIdField,
}: {
  urqlClient: Client;
  schema: IntrospectionQuery;
  autoIncludeIdField?: string;
}) {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        return (input: Record<string, any>) => {
          return makeGraphQLMutationRequest({
            mutationName: prop as string,
            input,
            client: urqlClient,
            schema,
            autoIncludeIdField,
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Mutation, false>;
}
