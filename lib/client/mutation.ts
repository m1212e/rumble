import type { Client } from "@urql/core";
import { makeGraphQLMutationRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeMutation<Mutation extends Record<string, any>>({
  urqlClient,
}: {
  urqlClient: Client;
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
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Mutation>;
}
