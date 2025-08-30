import type { Client } from "@urql/core";
import { capitalize } from "es-toolkit";
import { empty, map, merge, onPush, pipe, toObservable } from "wonka";

export const argsKey = "__args";

export function makeGraphQLRequest({
	queryName,
	input,
	client,
	enableSubscription = false,
}: {
	queryName: string;
	input: Record<string, any>;
	client: Client;
	enableSubscription?: boolean;
}) {
	const otwQueryName = `${capitalize(queryName)}Query`;
	const args = input[argsKey] ?? {};
	if (args) {
		input[argsKey] = undefined;
	}

	console.log(args);

	let currentValue: any;

	const response = pipe(
		merge([
			client.query(
				`query ${otwQueryName} { ${queryName} { ${stringifySelection(input)} }}`,
				{},
			),
			enableSubscription
				? client.subscription(
						`subscription ${otwQueryName} { ${queryName} { ${stringifySelection(input)} } }`,
						{},
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

function stringifyArgumentObjectToGraphqlList(args: Record<any, any>) {
	const entries = Object.entries(args);
	if (entries.length === 0) {
		return "";
	}

	return `(${entries.map(([key, value]) => `${key}: ${stringifyArgumentValue(value)}`).join(", ")})`;
}

function stringifyArgumentValue(arg: any): string {
	switch (typeof arg) {
		case "string":
			return `"${arg}"`;
		case "number":
			return `${arg}`;
		case "bigint":
			return `${arg}`;
		case "boolean":
			return `${arg}`;
		case "symbol":
			throw new Error("Cannot stringify a symbol to send as gql arg");
		case "undefined":
			return "null";
		case "object":
			return `{ ${Object.entries(arg)
				.map(([key, value]) => `${key}: ${stringifyArgumentValue(value)}`)
				.join(", ")} }`;
		case "function":
			throw new Error("Cannot stringify a function to send as gql arg");
	}
}
