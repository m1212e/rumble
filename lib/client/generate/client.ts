export function generateClient({
	apiUrl,
	rumbleImportPath,
	useExternalUrqlClient,
	availableSubscriptions,
}: {
	rumbleImportPath: string;
	useExternalUrqlClient: string | boolean;
	apiUrl: string;
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
		`import { makeQuery, makeMutation } from '${rumbleImportPath}';`,
	);

	if (!useExternalUrqlClient) {
		code += `
const urqlClient = new Client({
  url: "${apiUrl}",
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
  data: makeQuery<Query>({
	  urqlClient,
	  availableSubscriptions: new Set([${availableSubscriptions
			.values()
			.toArray()
			.map((value) => `"${value}"`)
			.join(", ")}]),
  }),
  mutate: makeMutation<Mutation>({
	  urqlClient,
  })
}`;

	return {
		imports,
		code,
	};
}
