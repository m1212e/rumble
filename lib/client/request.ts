import type { Client } from "@urql/core";
import { capitalize } from "es-toolkit";
import {
	empty,
	map,
	merge,
	onPush,
	pipe,
	share,
	toObservable,
	toPromise,
} from "wonka";

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

	const argsString = stringifyArgumentObjectToGraphqlList(input[argsKey] ?? {});
	const operationString = (operationVerb: "query" | "subscription") =>
		`${operationVerb} ${otwQueryName} { ${queryName}${argsString} { ${stringifySelection(input)} }}`;

	const promiseResolvedObjectReference = {};
	const response = pipe(
		merge([
			client.query(operationString("query"), {}),
			enableSubscription
				? client.subscription(operationString("subscription"), {})
				: empty,
		]),
		map((v) => {
			const data = v.data?.[queryName];
			if (!data && v.error) {
				throw v.error;
			}

			return data;
		}),
		share,
		onPush((data) => {
			Object.assign(promiseResolvedObjectReference, data);
		}),
	);

	const observable = toObservable(response);
	const data = toPromise(response).then((res) => {
		Object.assign(res, observable);
		Object.assign(promiseResolvedObjectReference, res);
		return promiseResolvedObjectReference;
	});
	Object.assign(data, observable);

	return data;

	// let awaited = false;

	// const ret = new Proxy(
	// 	{
	// 		warning:
	// 			"This is only a JS proxy passing on the current value of the latest received data. It will not work properly if serialized via JSON.stringify. If you want the actual data, use the '__raw' getter field on this exact object or subscribe to it via the subscribe method.",
	// 		get __raw() {
	// 			return currentValue;
	// 		},
	// 		...toObservable(response),
	// 	},
	// 	{
	// 		get: (target, prop) => {
	// 			if (prop === "then" && !awaited) {
	// 				return (onFullfilled: any) => {
	// 					(async () => {
	// 						const ret = await toPromise(response);
	// 						awaited = true;
	// 						onFullfilled(ret);
	// 					})();
	// 				};
	// 			}

	// 			if ((target as any)[prop] !== undefined) {
	// 				return (target as any)[prop];
	// 			}

	// 			return currentValue?.[prop];
	// 		},
	// 	},
	// );

	// return ret;
}

export function makeGraphQLMutation({
	mutationName,
	input,
	client,
}: {
	mutationName: string;
	input: Record<string, any>;
	client: Client;
}) {
	const otwMutationName = `${capitalize(mutationName)}Mutation`;

	const argsString = stringifyArgumentObjectToGraphqlList(input[argsKey] ?? {});

	const response = pipe(
		client.mutation(
			`mutation ${otwMutationName} { ${mutationName}${argsString} { ${stringifySelection(input)} }}`,
			{},
		),
		share,
		map((v) => {
			const data = v.data?.[mutationName];
			if (!data && v.error) {
				throw v.error;
			}

			return data;
		}),
	);

	const observable = toObservable(response);
	const data = toPromise(response).then((res) => {
		Object.assign(res, observable);
		return res;
	});
	Object.assign(data, observable);

	return data;
}

function stringifySelection(selection: Record<string, any>) {
	return Object.entries(selection)
		.filter(([key]) => key !== argsKey)
		.reduce((acc, [key, value]) => {
			if (typeof value === "object") {
				if (value[argsKey]) {
					const argsString = stringifyArgumentObjectToGraphqlList(
						value[argsKey],
					);
					acc += `${key}${argsString} { ${stringifySelection(value)} }
`;
					return acc;
				}

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
