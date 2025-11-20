import type { argsKey } from "./request";
import type {
  DeriveArrayType,
  DeriveNullability,
  ExtractGQLTypeFromField,
  RequireAtLeastOneFieldSet,
  UnArray,
  UnFunc,
} from "./utilTypes";

//TODO: Find out how to sanely refactor these types

export type QueryableObjectFromGeneratedTypes<Q> = {
  // do we have a simple type or a function that returns a type?
  [Key in keyof Q]: Q[Key] extends (p: infer QueryArgs) => infer QueryResponse
    ? <
        // if the field function has arguments, this means that gql accepts arguments
        Selected extends QueryArgs extends Record<string, any>
          ? // in that case we want to extend the object with an args key property
            ObjectFieldSelection<UnArray<NonNullable<QueryResponse>>> & {
              [argsKey]: QueryArgs;
            }
          : // for no-argument functions, we just want the selection
            ObjectFieldSelection<UnArray<NonNullable<QueryResponse>>>,
      >(
        s: Selected,
      ) => DeriveNullability<
        // transfer nullability from the original response type to the returned type
        QueryResponse,
        // wrap it in a return
        Response<
          DeriveArrayType<
            // transfer array-ness from the original response type to the returned type
            QueryResponse,
            // apply the selection to get the final type
            ApplySelection<ExtractGQLTypeFromField<QueryResponse>, Selected>
          >
        >
      >
    : // if it's a simple type, we just return the type wrapped in a response
      () => Response<Q[Key]>;
};

/**
 * The input to select fields for an object
 */
export type ObjectFieldSelection<O> = RequireAtLeastOneFieldSet<{
  [Key in keyof O]: NonNullable<UnArray<O[Key]>> extends (p: infer P) => infer A
    ? P extends Record<string, any>
      ? ObjectFieldSelection<UnArray<NonNullable<A>>> & { [argsKey]: P }
      : ObjectFieldSelection<UnArray<NonNullable<A>>>
    : boolean;
}>;

export type ApplySelection<Object, Selection> = {
  [Key in keyof Selection & keyof Object]: Object[Key] extends (
    p: infer _P,
  ) => infer _A
    ? ReturnType<Object[Key]> extends Array<any>
      ? Array<
          ApplySelection<
            UnArray<UnFunc<ReturnType<Object[Key]>>>,
            Selection[Key]
          >
        >
      : ApplySelection<UnArray<UnFunc<Object[Key]>>, Selection[Key]>
    : Object[Key];
};

export type Subscribeable<Data> = {
  subscribe: (subscription: (value: Data) => void) => () => void;
};

type Response<Data> = Data extends object
  ? {
      then: (onFulfilled: (value: Subscribeable<Data> & Data) => void) => void;
    } & Subscribeable<Data | undefined>
  : {
      // if this is a primitive type, we can't merge the Subscribeable with the Data type
      then: (onFulfilled: (value: Data) => void) => void;
    } & Subscribeable<Data | undefined>;
