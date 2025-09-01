import type { Client } from "@urql/core";
import type { QueryObject } from "./liveQuery";
import { makeGraphQLMutation, makeGraphQLQuery } from "./request";

export function makeQuery<Query extends Record<string, any>>({
	urqlClient,
}: {
	urqlClient: Client;
}) {
	return new Proxy(
		{},
		{
			get: (target, prop) => {
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
	) as QueryObject<Query>;
}
