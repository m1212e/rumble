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
	);

	// let currentValue: any;
	// const subscribeable: Subscribeable<any> = {
	// 	subscribe(subscription) {
	// 		const s = response.subscribe((v) => {
	// 			const data = v.data?.[queryName];

	// if (!data && v.error) {
	// 	throw v.error;
	// }

	// 			currentValue = data;
	// 			subscription(data);
	// 		});
	// 		return () => {
	// 			s.unsubscribe();
	// 		};
	// 	},
	// };

	const awaited = false;

	// const firstDataPushedToStore = (async () => {
	// 	let unsub: (() => void) | undefined;
	// 	await new Promise((resolve) => {
	// 		unsub = response.subscribe((d) => {
	// 			resolve(d);
	// 		}).unsubscribe;
	// 	});

	// 	unsub!();
	// 	awaited = true;
	// 	return ret;
	// })();

	const ret = new Proxy(toObservable(response), {
		get: (target, prop) => {
			if (prop === "then" && !awaited) {
				return async (onFullfilled: any) => {
					console.log("a");
					await toPromise(response);
					console.log("b");
					onFullfilled(ret);
				};
				// return (async () => {
				// 	console.log("adwadwad");
				// 	console.log("resolved", g);
				// 	awaited = true;
				// 	return ret;
				// })().then.bind(ret);
			}

			if ((target as any)[prop] !== undefined) {
				return (target as any)[prop];
			}

			return currentValue?.[prop];
		},
	});

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
