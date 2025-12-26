import type { Client } from "@urql/core";
import { makeGraphQLMutationRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeMutation<
  Mutation extends Record<string, any>,
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
        return (input: Record<string, any>) => {
          return makeGraphQLMutationRequest({
            mutationName: prop as string,
            input,
            client: urqlClient,
            forceReactivity,
          });
        };
      },
    },
  ) as QueryableObjectFromGeneratedTypes<Mutation, ForceReactivity>;
}
