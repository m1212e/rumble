import { type Client, createRequest } from "@urql/core";
import { capitalize } from "es-toolkit";
import type {
  IntrospectionField,
  IntrospectionInputValue,
  IntrospectionQuery,
  IntrospectionType,
} from "graphql";
import { DateResolver, DateTimeISOResolver } from "graphql-scalars";
import { createSubscriber } from "svelte/reactivity";

import {
  empty,
  fromValue,
  map,
  merge,
  onEnd,
  onStart,
  pipe,
  type Source,
  share,
  subscribe,
  take,
  toObservable,
  make,
} from "wonka";
import { lazy } from "../helpers/lazy";

const bc = new BroadcastChannel("RUMBLE_MUTATION_NOTIFIER");
type BroadcastMessage = {
  modifiedEntityIds: any[];
};

// TODO: this could use some refactoring and less type check disable (remove uses of any)
// TODO: the client needs tests

function typeToString(type: any): string {
  if (type.kind === "NON_NULL") return `${typeToString(type.ofType)}!`;
  if (type.kind === "LIST") return `[${typeToString(type.ofType)}]`;
  return type.name;
}

type VarContext = {
  variables: Record<string, any>;
  declarations: string[];
  usedNames: Set<string>;
};

function allocateVarName(ctx: VarContext, baseName: string): string {
  if (!ctx.usedNames.has(baseName)) {
    ctx.usedNames.add(baseName);
    return baseName;
  }
  let i = 1;
  while (ctx.usedNames.has(`${baseName}${i}`)) i++;
  const name = `${baseName}${i}`;
  ctx.usedNames.add(name);
  return name;
}

export const argsKey = "__args";

function makeOperation({
  operationVerb,
  queryName,
  schema,
  input,
  autoIncludeIdField,
}: {
  operationVerb: "query" | "subscription" | "mutation";
  queryName: string;
  schema: IntrospectionQuery;
  input?: Record<string, any>;
  autoIncludeIdField?: string;
}) {
  const otwQueryName = `${capitalize(queryName)}${capitalize(operationVerb)}`;
  const field = schema.__schema.types
    .filter((t) => t.kind === "OBJECT")
    .find((t) => t.name === schema.__schema[`${operationVerb}Type`]!.name)!
    .fields.find((f) => f.name === queryName)!;
  const types = schema.__schema.types;

  const varCtx: VarContext = {
    variables: {},
    declarations: [],
    usedNames: new Set(),
  };

  const selectionString = input
    ? stringifySelection({
        field,
        selection: input,
        types,
        autoIncludeIdField,
        varCtx,
      })
    : "";

  const argumentString = input?.[argsKey]
    ? serializeArguments({
        args: input[argsKey],
        fieldArgs: field.args,
        types,
        varCtx,
      })
    : "";

  const varDecl = varCtx.declarations.length
    ? `(${varCtx.declarations.join(", ")})`
    : "";

  return {
    operationString: `${operationVerb} ${otwQueryName}${varDecl} { ${queryName}${argumentString} ${selectionString}}`,
    variables: varCtx.variables,
  };
}

export function makeGraphQLQueryRequest({
  queryName,
  schema,
  input,
  client,
  enableSubscription = false,
  forceReactivity,
  autoIncludeIdField,
}: {
  queryName: string;
  schema: IntrospectionQuery;
  input?: Record<string, any>;
  client: Client;
  enableSubscription?: boolean;
  forceReactivity?: boolean;
  autoIncludeIdField?: string;
}) {
  let currentData: any;
  const dataProxy = lazy(
    () =>
      new Proxy(currentData, {
        get(target, prop, receiver) {
          svelteSubscriber();
          const val = Reflect.get(currentData, prop, receiver);
          if (typeof val === "function") {
            return val.bind(currentData);
          }
          return val;
        },
      }),
  );

  const svelteSubscriber = createSubscriber((update) => {
    const unsub = observable.subscribe((d) => {
      update();
    });
    return () => unsub.unsubscribe();
  });

  const { operationString, variables } = makeOperation({
    operationVerb: "query",
    queryName,
    input,
    schema,
    autoIncludeIdField,
  });

  const cacheUpdates = make(({ next, complete }) => {
    const broadcastHandler = async (event: MessageEvent<BroadcastMessage>) => {
      console.log("Received broadcast message", event.data);
      await new Promise((r) => setTimeout(r, 100));
      const cacheValue = client.readQuery(operationString, variables);
      if (cacheValue) {
        console.log({ cacheValue });
        if (cacheValue.error) {
          console.warn(
            "Error reading from cache in broadcast handler",
            cacheValue.error,
          );
          return;
        }
        const data = cacheValue.data?.[queryName];
        console.log({ data });
        if (typeof data === "object" && data !== null) {
          currentData = data;
          next(dataProxy());
        }
      } else {
        console.log("no cache value :{");
      }
    };
    bc.addEventListener("message", broadcastHandler);

    return () => {
      bc.removeEventListener("message", broadcastHandler);
    };
  });

  const observableSources: Source<any>[] = [
    client.query(operationString, variables),
    cacheUpdates,
  ];
  if (enableSubscription) {
    const { operationString: subOpString, variables: subVars } = makeOperation({
      operationVerb: "subscription",
      queryName,
      input,
      schema,
      autoIncludeIdField,
    });
    observableSources.push(client.subscription(subOpString, subVars));
  }
  const observable = toObservable(
    pipe(
      merge(observableSources),
      share,
      map((v: any) => {
        if (v.error) {
          throw v.error;
        }

        const data = v.data?.[queryName];
        if (typeof data === "object" && data !== null) {
          currentData = data;
          return dataProxy();
        }
        return data;
      }),
    ),
  );

  const promise = new Promise<any>((resolve, reject) => {
    pipe(
      client.query(operationString, variables),
      take(1),
      subscribe((v: any) => {
        if (v.error) {
          reject(v.error);
          return;
        }

        const data = v.data?.[queryName];
        if (typeof data !== "object" || data === null) {
          resolve(data);
          return;
        }
        if (typeof forceReactivity === "boolean" && forceReactivity) {
          resolve(observable);
          return;
        }

        currentData = data;
        observableSources.push(fromValue(data));

        try {
          const r = dataProxy();
          Object.assign(r, observable);
          resolve(r);
        } catch (err) {
          reject(err);
        }
      }),
    );
  });

  Object.assign(promise, observable);
  return promise;
}

export function makeGraphQLMutationRequest({
  mutationName,
  input,
  client,
  schema,
  autoIncludeIdField,
}: {
  mutationName: string;
  input: Record<string, any>;
  client: Client;
  schema: IntrospectionQuery;
  autoIncludeIdField?: string;
}) {
  const { operationString, variables } = makeOperation({
    operationVerb: "mutation",
    queryName: mutationName,
    input,
    schema,
    autoIncludeIdField,
  });

  const mutation = pipe(
    client.mutation(operationString, variables),
    map((v) => {
      if (v.error) {
        return v;
      }

      const data = v.data?.[mutationName];
      bc.postMessage({
        modifiedEntityIds: [],
      } as BroadcastMessage);
      return v;
    }),
  );

  const observable = toObservable(
    pipe(
      mutation,
      share,
      map((v) => {
        if (v.error) {
          throw v.error;
        }

        const data = v.data?.[mutationName];
        return data;
      }),
    ),
  );

  const promise = new Promise<any>((resolve, reject) => {
    pipe(
      mutation,
      take(1),
      subscribe((v: any) => {
        if (v.error) {
          reject(v.error);
          return;
        }

        resolve(v.data?.[mutationName]);
      }),
    );
  });

  Object.assign(promise, observable);
  return promise;
}

export function makeGraphQLSubscriptionRequest({
  subscriptionName,
  input,
  client,
  schema,
  autoIncludeIdField,
}: {
  subscriptionName: string;
  input: Record<string, any>;
  client: Client;
  schema: IntrospectionQuery;
  autoIncludeIdField?: string;
}) {
  const { operationString, variables } = makeOperation({
    operationVerb: "subscription",
    queryName: subscriptionName,
    input,
    schema,
    autoIncludeIdField,
  });

  return pipe(
    client.subscription(operationString, variables),
    map((v) => {
      if (v.error) {
        throw v.error;
      }

      return v.data?.[subscriptionName];
    }),
    toObservable,
  ) as any;
}

function stringifySelection({
  field,
  selection,
  types,
  autoIncludeIdField,
  varCtx,
}: {
  selection: Record<string, any>;
  field: IntrospectionField;
  types: readonly IntrospectionType[];
  autoIncludeIdField?: string;
  varCtx: VarContext;
}) {
  if (
    autoIncludeIdField &&
    typeof selection[autoIncludeIdField] === "undefined"
  ) {
    selection[autoIncludeIdField] = true;
  }

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

          argsString = serializeArguments({
            args: value[argsKey],
            types,
            fieldArgs: referenceObject.args,
            varCtx,
          });
        }

        acc += `${key}${argsString} ${stringifySelection({
          field,
          selection: value,
          types,
          varCtx,
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

function serializeArguments({
  args,
  fieldArgs,
  types,
  varCtx,
}: {
  args: Record<any, any>;
  fieldArgs: readonly IntrospectionInputValue[];
  types: readonly IntrospectionType[];
  varCtx: VarContext;
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

        const varName = allocateVarName(varCtx, key);
        varCtx.declarations.push(`$${varName}: ${typeToString(gqlArg.type)}`);
        varCtx.variables[varName] = serializeArgValue({
          arg: value,
          gqlArg,
          types,
        });

        return `${key}: $${varName}`;
      })
      .join(", ")})`;
  }

  return "";
}

function serializeArgValue({
  arg,
  gqlArg,
  types,
}: {
  arg: any;
  gqlArg: IntrospectionInputValue;
  types: readonly IntrospectionType[];
}): any {
  if (arg === null) {
    return null;
  }

  if (Array.isArray(arg)) {
    return arg.map((v) => {
      return serializeArgValue({
        arg: v,
        types,
        gqlArg,
      });
    });
  }

  const argtype = typeof arg;

  if (argtype === "object" && !(arg instanceof Date)) {
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

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(arg)) {
      const subArgType = referenceInputObject.inputFields.find(
        (t) => t.name === key,
      );

      if (!subArgType) {
        throw new Error(
          `Expected an INPUT_OBJECT hit in named based lookup for name ${key} with arg ${referenceInputObject.inputFields.map((f) => f.name).join(", ")}`,
        );
      }

      result[key] = serializeArgValue({
        arg: value,
        types,
        gqlArg: subArgType,
      });
    }
    return result;
  }

  let type = gqlArg.type;

  if (type.kind === "NON_NULL") {
    type = type.ofType;
  }

  if (arg instanceof Date) {
    const name = (type as any).name;
    let value: string;
    switch (name) {
      case "Date":
        value = DateResolver.serialize(arg);
        break;
      case "DateTime":
        value = DateTimeISOResolver.serialize(arg);
        break;
      default:
        throw new Error(
          `Unrecognized date type ${name}, expected Date or DateTime`,
        );
    }
    return value;
  }

  switch (typeof arg) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
      return arg;
    case "symbol":
      throw new Error("Cannot stringify a symbol to send as gql arg");
    case "undefined":
      return null;
    case "function":
      throw new Error("Cannot stringify a function to send as gql arg");
  }

  throw new Error("Cannot stringify an unknown type");
}
