import type { Client } from "@urql/core";
import type { QueryObject } from "./query";
import { makeGraphQLMutation } from "./request";

export function makeMutation<Mutation extends Record<string, any>>({
	urqlClient,
}: {
	urqlClient: Client;
}) {
	const selectionProxy = new Proxy(
		{},
		{
			get: (target, prop) => {
				if (typeof prop === "symbol") {
					console.warn(
						"The selector seems to be have called with a symbol instead of a string, this is incorrect and cannot be handled",
					);
					return selectionProxy;
				}

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

	return selectionProxy;
}
