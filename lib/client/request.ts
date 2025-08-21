import { type Client, cacheExchange, fetchExchange } from "@urql/core";
import { capitalize } from "es-toolkit";
import {
	empty,
	fromArray,
	map,
	merge,
	never,
	onPush,
	pipe,
	share,
	toObservable,
	toPromise,
} from "wonka";
import type { Response, Subscribeable } from "./query";

export function makeGraphQLRequest({
	queryName,
	selection,
	client,
	enableSubscription = false,
}: {
	queryName: string;
	selection: Record<string, any>;
	client: Client;
	enableSubscription?: boolean;
}) {
	const otwQueryName = `${capitalize(queryName)}Query`;
	const args = {
		//  id: "test"
	};

	let currentValue: any;

	const response = pipe(
		merge([
			client.query(
				`query ${otwQueryName} { ${queryName} { ${stringifySelection(selection)} }}`,
				args,
			),
			enableSubscription
				? client.subscription(
						`subscription ${otwQueryName} { ${queryName} { ${stringifySelection(selection)} } }`,
						args,
					)
				: empty,
		]),
		// share,
		map((v) => {
			const data = v.data?.[queryName];
			if (!data && v.error) {
				throw v.error;
			}

			return data;
		}),
		onPush((data) => {
			currentValue = data;
		}),
		toObservable,
	);

	let awaited = false;

	const ret = new Proxy(
		{
			warning:
				"This is only a JS proxy passing on the current value of the latest received data. It will not work properly if serialized via JSON.stringify. If you want the actual data, use the '__raw' getter field on this exact object or subscribe to it via the subscribe method.",
			get __raw() {
				return currentValue;
			},
			...response,
		},
		{
			get: (target, prop) => {
				if (prop === "then" && !awaited) {
					return (onFullfilled: any) => {
						(async () => {
							let unsub: (() => void) | undefined;
							await new Promise((resolve) => {
								unsub = response.subscribe((d) => {
									resolve(d);
								}).unsubscribe;
							});
							unsub!();
							awaited = true;
							onFullfilled(ret);
						})();
					};
				}

				if ((target as any)[prop] !== undefined) {
					return (target as any)[prop];
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
