import type { Client } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeGraphQLMutationRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeMutation<Mutation extends Record<string, any>>({
  urqlClient,
  schema,
}: {
  urqlClient: Client;
  schema: IntrospectionQuery;
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
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Mutation, false>;
}
