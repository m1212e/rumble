export function generateClient({
  apiUrl,
  rumbleImportPath,
  useExternalUrqlClient,
  availableSubscriptions,
}: {
  rumbleImportPath: string;
  useExternalUrqlClient: string | boolean;
  apiUrl?: string;
  availableSubscriptions: Set<string>;
}) {
  const imports: string[] = [];
  let code: string = "";

  if (typeof useExternalUrqlClient === "string") {
    imports.push(`import { urqlClient } from "${useExternalUrqlClient}";`);
  } else {
    imports.push(`import { Client, fetchExchange } from '@urql/core';`);
    imports.push(`import { cacheExchange } from '@urql/exchange-graphcache';`);
  }

  imports.push(
    `import { makeLiveQuery, makeMutation, makeSubscription, makeQuery } from '${rumbleImportPath}';`,
  );

  if (!useExternalUrqlClient) {
    code += `
const urqlClient = new Client({
  url: "${apiUrl ?? "PLEASE PROVIDE A URL WHEN GENERATING OR IMPORT AN EXTERNAL URQL CLIENT"}",
  fetchSubscriptions: true,
  exchanges: [cacheExchange({}), fetchExchange],
  fetchOptions: {
    credentials: "include",
  },
  requestPolicy: "cache-and-network",
});
`;
  }

  code += `
export const client = {
  /**
   * A query and subscription combination. First queries and if exists, also subscribes to a subscription of the same name.
   * Combines the results of both, so the result is first the query result and then live updates from the subscription.
   * Assumes that the query and subscription return the same fields as per default when using the rumble query helpers.
   * If no subscription with the same name exists, this will just be a query.
   */
  liveQuery: makeLiveQuery<Query>({
	  urqlClient,
	  availableSubscriptions: new Set([${availableSubscriptions
      .values()
      .toArray()
      .map((value) => `"${value}"`)
      .join(", ")}]),
  }),
  /**
   * A mutation that can be used to e.g. create, update or delete data.
   */
  mutate: makeMutation<Mutation>({
	  urqlClient,
  }),
  /**
   * A continuous stream of results that updates when the server sends new data.
   */
  subscribe: makeSubscription<Subscription>({
	  urqlClient,
  }),
  /**
   * A one-time fetch of data.
   */
  query: makeQuery<Query>({
	  urqlClient,
  }),
}`;

  return {
    imports,
    code,
  };
}
