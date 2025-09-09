import type { Client } from "@urql/core";
import type { QueryObject } from "./liveQuery";
import { makeGraphQLMutation } from "./request";

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
					return makeGraphQLMutation({
						mutationName: prop as string,
						input,
						client: urqlClient,
					});
				};
			},
		},
	) as QueryObject<Mutation>;
}
