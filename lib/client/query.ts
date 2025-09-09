import type { Client } from "@urql/core";
import { makeGraphQLQuery } from "./request";
import type { QueryableObjectFromGeneratedTypes } from "./types";

export function makeQuery<Query extends Record<string, any>>({
	urqlClient,
}: {
	urqlClient: Client;
}) {
	return new Proxy(
		{},
		{
			get: (_target, prop) => {
				return (input: Record<string, any>) => {
					return makeGraphQLQuery({
						queryName: prop as string,
						input,
						client: urqlClient,
						enableSubscription: false,
					});
				};
			},
		},
	) as QueryableObjectFromGeneratedTypes<Query>;
}
