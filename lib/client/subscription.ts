import type { Client } from "@urql/core";
import type { QueryObject } from "./liveQuery";
import { makeGraphQLSubscription } from "./request";

export function makeSubscription<Subscription extends Record<string, any>>({
	urqlClient,
}: {
	urqlClient: Client;
}) {
	return new Proxy(
		{},
		{
			get: (target, prop) => {
				return (input: Record<string, any>) => {
					return makeGraphQLSubscription({
						subscriptionName: prop as string,
						input,
						client: urqlClient,
					});
				};
			},
		},
	) as QueryObject<Subscription>;
}
