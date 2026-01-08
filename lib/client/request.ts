import type { Client } from "@urql/core";
import { capitalize } from "es-toolkit";
import type {
  IntrospectionField,
  IntrospectionInputValue,
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

// TODO: this could use some refactoring and less type check disable (remove uses of any)
// TODO: the client needs tests

export const argsKey = "__args";

function makeOperationString({
  operationVerb,
  queryName,
  schema,
  input,
}: {
  operationVerb: "query" | "subscription" | "mutation";
  queryName: string;
  schema: IntrospectionQuery;
  input?: Record<string, any>;
}) {
  const otwQueryName = `${capitalize(queryName)}${capitalize(operationVerb)}`;
  const field = schema.__schema.types
    .filter((t) => t.kind === "OBJECT")
    .find((t) => t.name === schema.__schema[`${operationVerb}Type`]!.name)!
    .fields.find((f) => f.name === queryName)!;
  const types = schema.__schema.types;

  const selectionString = input
    ? stringifySelection({ field, selection: input, types })
    : "";

  const argumentString = input?.[argsKey]
    ? stringifyArgumentObjectToGraphql({
        args: input[argsKey],
        fieldArgs: field.args,
        types,
      })
    : "";

  const ret = `${operationVerb} ${otwQueryName} { ${queryName}${argumentString} ${selectionString}}`;
  return ret;
}

export function makeGraphQLQueryRequest({
  queryName,
  schema,
  input,
  client,
  enableSubscription = false,
  forceReactivity,
}: {
  queryName: string;
  schema: IntrospectionQuery;
  input?: Record<string, any>;
  client: Client;
  enableSubscription?: boolean;
  forceReactivity?: boolean;
}) {
  let awaitedReturnValueReference = {};

  const source = pipe(
    merge([
      client.query(
        makeOperationString({
          operationVerb: "query",
          queryName,
          input,
          schema,
        }),
        {},
      ),
      enableSubscription
        ? client.subscription(
            makeOperationString({
              operationVerb: "subscription",
              queryName,
              input,
              schema,
            }),
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
    // keep the returned object reference updated with new data
    onPush((data) => {
      if (
        typeof data === "object" &&
        data !== null &&
        typeof forceReactivity === "boolean" &&
        forceReactivity
      ) {
        // TODO: Object assign calls should not overwrite store or promise fields
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
        if (
          typeof data === "object" &&
          data !== null &&
          typeof forceReactivity === "boolean" &&
          forceReactivity
        ) {
          awaitedReturnValueReference = data;
          Object.assign(awaitedReturnValueReference, observable);
          return awaitedReturnValueReference;
        }
        return observable;
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
  schema,
}: {
  mutationName: string;
  input: Record<string, any>;
  client: Client;
  schema: IntrospectionQuery;
}) {
  const response = pipe(
    client.mutation(
      makeOperationString({
        operationVerb: "mutation",
        queryName: mutationName,
        input,
        schema,
      }),
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
  const promise = toPromise(pipe(response, take(1)));
  Object.assign(promise, observable);

  return promise;
}

export function makeGraphQLSubscriptionRequest({
  subscriptionName,
  input,
  client,
  schema,
}: {
  subscriptionName: string;
  input: Record<string, any>;
  client: Client;
  schema: IntrospectionQuery;
}) {
  return pipe(
    client.subscription(
      makeOperationString({
        operationVerb: "subscription",
        queryName: subscriptionName,
        input,
        schema,
      }),
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

function stringifySelection({
  field,
  selection,
  types,
}: {
  selection: Record<string, any>;
  field: IntrospectionField;
  types: readonly IntrospectionType[];
}) {
  const ret = Object.entries(selection)
    .filter(([key]) => key !== argsKey)
    .reduce((acc, [key, value]) => {
      if (typeof value === "object") {
        let argsString = "";
        if (value[argsKey]) {
          let type = field.type;

          if (type.kind === "NON_NULL") {
            type = type.ofType;
          }
          if (type.kind === "LIST") {
            type = type.ofType;
          }
          if (type.kind === "NON_NULL") {
            type = type.ofType;
          }

          const referenceObject = (types as any)
            .find((t: any) => t.name === (type as any).name)
            .fields.find((f: any) => f.name === key);

          argsString = stringifyArgumentObjectToGraphql({
            args: value[argsKey],
            types,
            fieldArgs: referenceObject.args,
          });
        }

        acc += `${key}${argsString} ${stringifySelection({
          field,
          selection: value,
          types,
        })}
`;
      } else {
        if (typeof value === "boolean" && value) {
          acc += `${key}
`;
        }
      }
      return acc;
    }, "");

  return `{
${ret} }`;
}

function stringifyArgumentObjectToGraphql({
  args,
  fieldArgs,
  types,
}: {
  args: Record<any, any>;
  fieldArgs: readonly IntrospectionInputValue[];
  types: readonly IntrospectionType[];
}) {
  const entries = Object.entries(args);

  if (entries.length > 0) {
    return `(${entries
      .map(([key, value]) => {
        const gqlArg = fieldArgs.find((a) => a.name === key);

        if (!gqlArg) {
          throw new Error(
            `Argument ${key} not found in field args list ${JSON.stringify(fieldArgs.map((a) => a.name))}`,
          );
        }

        return `${key}: ${stringifyArgumentValue({ arg: value, gqlArg, types })}`;
      })
      .join(", ")})`;
  }

  return "";
}

function stringifyArgumentValue({
  arg,
  gqlArg,
  types,
}: {
  arg: any;
  gqlArg: IntrospectionInputValue;
  types: readonly IntrospectionType[];
}): string {
  if (arg === null) {
    return "null";
  }

  if (Array.isArray(arg)) {
    return `[${arg
      .map((v) => {
        return stringifyArgumentValue({
          arg: v,
          types,
          gqlArg,
        });
      })
      .join(", ")}]`;
  }

  const argtype = typeof arg;

  if (argtype === "object") {
    let type = gqlArg.type;

    if (type.kind === "NON_NULL") {
      type = type.ofType;
    }
    if (type.kind === "LIST") {
      type = type.ofType;
    }
    if (type.kind === "NON_NULL") {
      type = type.ofType;
    }

    // if (type.kind !== "INPUT_OBJECT") {
    //   throw new Error("Expected an INPUT_OBJECT type");
    // }

    const referenceInputObject = types.find(
      (t) => t.name === (type as any).name,
    );

    if (!referenceInputObject) {
      throw new Error(
        `Expected an INPUT_OBJECT hit in name based lookup for name ${(type as any).name} with arg ${JSON.stringify(arg)}`,
      );
    }

    if (referenceInputObject.kind !== "INPUT_OBJECT") {
      throw new Error("Expected an INPUT_OBJECT hit in named based lookup");
    }

    return `{ ${Object.entries(arg)
      .map(([key, value]) => {
        const subArgType = referenceInputObject.inputFields.find(
          (t) => t.name === key,
        );

        if (!subArgType) {
          throw new Error(
            `Expected an INPUT_OBJECT hit in named based lookup for name ${key} with arg ${referenceInputObject.inputFields.map((f) => f.name).join(", ")}`,
          );
        }

        return `${key}: ${stringifyArgumentValue({ arg: value, types, gqlArg: subArgType })}`;
      })
      .join(", ")} }`;
  }

  let type = gqlArg.type;

  if (type.kind === "NON_NULL") {
    type = type.ofType;
  }

  switch (typeof arg) {
    case "string":
      return type.kind === "ENUM" ? arg : `"${arg}"`;
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
    case "function":
      throw new Error("Cannot stringify a function to send as gql arg");
  }

  throw new Error("Cannot stringify an unknown type");
}
