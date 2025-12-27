import type { Client } from "@urql/core";
import { capitalize } from "es-toolkit";
import type {
  IntrospectionField,
  IntrospectionQuery,
  IntrospectionType,
} from "graphql";
import {
  empty,
  map,
  merge,
  onPush,
  pipe,
  share,
  take,
  toObservable,
  toPromise,
} from "wonka";

export const argsKey = "__args";

export function makeGraphQLQueryRequest({
  queryName,
  input,
  client,
  enableSubscription = false,
  forceReactivity,
  schema,
}: {
  queryName: string;
  input?: Record<string, any>;
  client: Client;
  enableSubscription?: boolean;
  forceReactivity?: boolean;
  schema: IntrospectionQuery;
}) {
  const otwQueryName = `${capitalize(queryName)}Query`;
  const argsString = stringifyArgumentObjectToGraphqlList({
    args: input?.[argsKey] ?? {},
    field: schema.__schema.types
      .filter((t) => t.kind === "OBJECT")
      .find((t) => t.name === schema.__schema.queryType!.name)!
      .fields.find((f) => f.name === queryName)!,
    types: schema.__schema.types,
  });
  const operationString = (operationVerb: "query" | "subscription") =>
    `${operationVerb} ${otwQueryName} { ${queryName}${argsString} ${input ? `{ ${stringifySelection(input)} }` : ""}}`;

  const awaitedReturnValueReference = {};

  const source = pipe(
    merge([
      client.query(operationString("query"), {}),
      enableSubscription
        ? client.subscription(operationString("subscription"), {})
        : empty,
    ]),
    share,
    map((v) => {
      const data = v.data?.[queryName];
      if (!data && v.error) {
        throw v.error;
      }

      return data;
    }),
    // keep the returned object reference updated with new data
    onPush((data) => {
      if (
        typeof data === "object" &&
        data !== null &&
        typeof forceReactivity === "boolean" &&
        forceReactivity
      ) {
        Object.assign(awaitedReturnValueReference, data);
      }
    }),
  );

  const observable = toObservable(source);
  const promise = toPromise(
    pipe(
      source,
      take(1),
      map((data) => {
        Object.assign(awaitedReturnValueReference, observable);
        if (
          typeof data === "object" &&
          data !== null &&
          typeof forceReactivity === "boolean" &&
          forceReactivity
        ) {
          Object.assign(awaitedReturnValueReference, data);
          return awaitedReturnValueReference;
        }

        return data;
      }),
    ),
  );
  Object.assign(promise, observable);

  return promise;
}

export function makeGraphQLMutationRequest({
  mutationName,
  input,
  client,
  forceReactivity,
  schema,
}: {
  mutationName: string;
  input: Record<string, any>;
  client: Client;
  forceReactivity?: boolean;
  schema: IntrospectionQuery;
}) {
  const otwMutationName = `${capitalize(mutationName)}Mutation`;
  const argsString = stringifyArgumentObjectToGraphqlList({
    args: input[argsKey] ?? {},
    field: schema.__schema.types
      .filter((t) => t.kind === "OBJECT")
      .find((t) => t.name === schema.__schema.mutationType!.name)!
      .fields.find((f) => f.name === mutationName)!,
    types: schema.__schema.types,
  });
  const operationString = `mutation ${otwMutationName} { ${mutationName}${argsString} { ${stringifySelection(input)} }}`;

  const response = pipe(
    client.mutation(operationString, {}),
    map((v) => {
      const data = v.data?.[mutationName];
      if (!data && v.error) {
        throw v.error;
      }

      return data;
    }),
  );

  const observable = toObservable(response);
  const promise = toPromise(pipe(response, take(1)));
  Object.assign(promise, observable);

  return promise;
}

export function makeGraphQLSubscriptionRequest({
  subscriptionName,
  input,
  client,
  forceReactivity,
  schema,
}: {
  subscriptionName: string;
  input: Record<string, any>;
  client: Client;
  forceReactivity?: boolean;
  schema: IntrospectionQuery;
}) {
  const otwSubscriptionName = `${capitalize(subscriptionName)}Subscription`;
  const argsString = stringifyArgumentObjectToGraphqlList({
    args: input[argsKey] ?? {},
    field: schema.__schema.types
      .filter((t) => t.kind === "OBJECT")
      .find((t) => t.name === schema.__schema.subscriptionType!.name)!
      .fields.find((f) => f.name === subscriptionName)!,
    types: schema.__schema.types,
  });

  const operationString = `subscription ${otwSubscriptionName} { ${subscriptionName}${argsString} { ${stringifySelection(input)} }}`;

  return pipe(
    client.subscription(operationString, {}),
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
          const argsString = stringifyArgumentObjectToGraphqlList({
            args: value[argsKey],
          });
          acc += `${key}${argsString} { ${stringifySelection(value)} }
`;
          return acc;
        }

        acc += `${key} {
${stringifySelection(value)} }
`;
      } else {
        acc += `${key}
`;
      }
      return acc;
    }, "");
}

function stringifyArgumentObjectToGraphqlList({
  args,
  field,
  types,
}: {
  args: Record<any, any>;
  field: IntrospectionField;
  types: readonly IntrospectionType[];
}) {
  const entries = Object.entries(args);
  if (Array.isArray(args)) {
    return `(${stringifyArgumentValue(args)})`;
  }

  if (entries.length > 0) {
    // Object without the {} brackets since we don't want them at the top level arguments
    return `(${entries.map(([key, value]) => `${key}: ${stringifyArgumentValue(value)}`).join(", ")})`;
  }

  return "";
}

function stringifyArgumentValue({
  arg,
  field,
  types,
}: {
  arg: any;
  field: IntrospectionField;
  types: IntrospectionType[];
}): string {
  if (arg === null) {
    return "null";
  }

  if (Array.isArray(arg)) {
    return `[${arg.map(stringifyArgumentValue).join(", ")}]`;
  }

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
        .map(
          ([key, value]) =>
            `${key}: ${stringifyArgumentValue({ arg: value, field, types })}`,
        )
        .join(", ")} }`;
    case "function":
      throw new Error("Cannot stringify a function to send as gql arg");
  }
}
