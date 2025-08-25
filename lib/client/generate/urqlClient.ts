export function generateClient({
	apiUrl,
	useExternalUrqlClient,
}: {
	useExternalUrqlClient: string | boolean;
	apiUrl: string;
}) {
	const imports: string[] = [];
	let code: string = "";

	if (typeof useExternalUrqlClient === "string") {
		imports.push(`import { urqlClient } from "${useExternalUrqlClient}";`);
	} else {
		imports.push(`import { Client, fetchExchange } from '@urql/core';`);
		imports.push(`import { cacheExchange } from '@urql/exchange-graphcache';`);
	}

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

	return {
		imports,
		code,
	};
}
