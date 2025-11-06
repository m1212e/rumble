import type { Client } from "@urql/core";
import { capitalize } from "es-toolkit";
import {
  empty,
  map,
  merge,
  onPush,
  pipe,
  toObservable,
  toPromise,
} from "wonka";

export const argsKey = "__args";

export function makeGraphQLQuery({
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

  let awaitedReturnValueReference: any;

  const observable = pipe(
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
    // keep the returned object reference updated with new data
    onPush((data) => {
      if (awaitedReturnValueReference) {
        Object.assign(awaitedReturnValueReference, data);
      }
    }),
    toObservable,
  );

  const promise = new Promise((resolve) => {
    const unsub = observable.subscribe((v) => {
      unsub();
      awaitedReturnValueReference = Object.assign(v, observable);
      resolve(awaitedReturnValueReference);
    }).unsubscribe;
  });

  Object.assign(promise, observable);

  return promise;
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
    map((v) => {
      const data = v.data?.[mutationName];
      if (!data && v.error) {
        throw v.error;
      }

      return data;
    }),
  );

  const observable = toObservable(response);
  const promise = toPromise(response).then((res) => {
    Object.assign(res, observable);
    return res;
  });
  Object.assign(promise, observable);

  return promise;
}

export function makeGraphQLSubscription({
  subscriptionName,
  input,
  client,
}: {
  subscriptionName: string;
  input: Record<string, any>;
  client: Client;
}) {
  const otwSubscriptionName = `${capitalize(subscriptionName)}Subscription`;
  const argsString = stringifyArgumentObjectToGraphqlList(input[argsKey] ?? {});

  return pipe(
    client.subscription(
      `subscription ${otwSubscriptionName} { ${subscriptionName}${argsString} { ${stringifySelection(input)} }}`,
      {},
    ),
    map((v) => {
      const data = v.data?.[subscriptionName];
      if (!data && v.error) {
        throw v.error;
      }

      return data;
    }),
    toObservable,
  ) as any;
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
