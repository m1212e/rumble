import type { Client } from "@urql/core";
import type { IntrospectionQuery } from "graphql";
import { makeGraphQLMutationRequest } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeMutation<
  Mutation extends Record<string, any>,
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
  ) as QueryableObjectFromGeneratedTypes<Mutation, false, IdField>;
}
