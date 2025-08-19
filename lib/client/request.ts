import { type Client, cacheExchange, fetchExchange } from "@urql/core";
import { capitalize } from "es-toolkit";
import type { Response, Subscribeable } from "./query";

export function makeGraphQLRequest({
	queryName,
	selection,
	client,
}: {
	queryName: string;
	selection: Record<string, any>;
	client: Client;
}) {
	const otwQueryName = `${capitalize(queryName)}Query`;

	const response = client.query(
		`query ${otwQueryName} {
  ${queryName} {
    ${stringifySelection(selection)}
  }
}
`,
		{
			//  id: "test"
		},
	);

	let currentValue: any;
	const subscribeable: Subscribeable<any> = {
		subscribe(subscription) {
			const s = response.subscribe((v) => {
				const data = v.data?.[queryName];

				if (!data && v.error) {
					throw v.error;
				}

				currentValue = data;
				subscription(data);
			});
			return () => {
				s.unsubscribe();
			};
		},
	};

	let ret: any;
	let awaited = false;

	const firstDataPushedToStore = (async () => {
		let unsub: (() => void) | undefined;
		await new Promise((resolve) => {
			unsub = subscribeable.subscribe((d) => {
				resolve(d);
			});
		});

		unsub!();
		awaited = true;
		return ret;
	})();

	ret = new Proxy(
		{
			warning:
				"This object is a JS proxy that offers all the current fields of the result. Please access the fields directly or subscribe to receive a normal object",
		},
		{
			get: (target, prop) => {
				if (prop === "subscribe") {
					return subscribeable.subscribe;
				}
				if (prop === "then" && !awaited) {
					return firstDataPushedToStore.then.bind(firstDataPushedToStore);
				}

				return currentValue?.[prop];
			},
		},
	);

	return ret;
}

function stringifySelection(selection: Record<string, any>) {
	return Object.entries(selection).reduce((acc, [key, value]) => {
		if (typeof value === "object") {
			acc += `${key} { ${stringifySelection(value)} }
`;
		} else {
			acc += `${key}
`;
		}
		return acc;
	}, "");
}
