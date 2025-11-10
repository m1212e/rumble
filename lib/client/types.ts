import type { argsKey } from "./request";
import type { RequireAtLeastOneFieldSet, UnArray, UnFunc } from "./utilTypes";

//TODO: Find out how to sanely refactor these types

/**
 * A gql object defined from the generated types.
 * Most keys are functions that take a selection set and return a promise of the selected data.
 */
export type QueryableObjectFromGeneratedTypes<Q> = {
  [Key in keyof Q]: QueryableObjectField<Q[Key]>;
};

type QueryableObjectField<T> =
  // in case this is a function and not a simple field, transform the function to callable ts types
  T extends (p: infer QueryArgs) => infer QueryResponse
    ? <
        // if the field function has arguments, this means that gql accepts arguments
        Selected extends QueryArgs extends Record<string, any>
          ? // in that case we want to extend the object with an args key property
            ObjectFieldSelection<UnArray<NonNullable<QueryResponse>>> & {
              [argsKey]: QueryArgs;
            }
          : ObjectFieldSelection<UnArray<NonNullable<QueryResponse>>>,
      >(
        s: Selected,
      ) => QueryResponse extends null
        ? Response<
            QueryResponse extends Array<any>
              ? ApplySelection<
                  NonNullable<UnArray<UnFunc<QueryResponse>>>,
                  Selected
                >[]
              : ApplySelection<
                  NonNullable<UnArray<UnFunc<QueryResponse>>>,
                  Selected
                >
          > | null
        : Response<
            QueryResponse extends Array<any>
              ? ApplySelection<UnArray<UnFunc<QueryResponse>>, Selected>[]
              : ApplySelection<UnArray<UnFunc<QueryResponse>>, Selected>
          >
    : // otherwise this is just types as a simple field
      Response<T>;

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

type Response<Data> = {
  then: (onFulfilled: (value: Subscribeable<Data> & Data) => void) => void;
} & Subscribeable<Data | undefined>;
