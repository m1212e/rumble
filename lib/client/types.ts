import type { argsKey } from "./request";
import type {
  ArgsSelection,
  DeriveArrayType,
  DeriveNullability,
  ExtractGQLTypeFromField,
  RequireAtLeastOneFieldSet,
  UnArray,
} from "./utilTypes";

//TODO: Find out how to sanely refactor these types

/**
 * `IdField` is the field the client adds to every selection of a type that has it
 * (`autoIncludeIdField`), so the result types carry it without it being selected.
 */
export type QueryableObjectFromGeneratedTypes<
  Q,
  ForceReactivity extends boolean,
  IdField extends string = never,
> = {
  // do we have a simple type or a function that returns a type?
  [Key in keyof Q]: Q[Key] extends (p: infer QueryArgs) => infer QueryResponse
    ? NonNullable<QueryResponse> extends object
      ? <
          // the selection, with the field's arguments under the args key if it takes any
          Selected extends ObjectFieldSelection<
            UnArray<NonNullable<QueryResponse>>
          > &
            ArgsSelection<QueryArgs>,
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
              ApplySelection<
                ExtractGQLTypeFromField<QueryResponse>,
                Selected,
                IdField
              >
            >,
            ForceReactivity
          >
        >
      : // scalar return type with args — args passed via __args key, no field selection needed
        (p: {
          [argsKey]: QueryArgs;
        }) => Response<QueryResponse, ForceReactivity>
    : // if it's a simple type with no args, we just return the type wrapped in a response
      () => Response<Q[Key], ForceReactivity>;
};

/**
 * The input to select fields for an object
 */
export type ObjectFieldSelection<O> = RequireAtLeastOneFieldSet<{
  [Key in keyof O]: NonNullable<UnArray<O[Key]>> extends (p: infer P) => infer A
    ? unknown extends P
      ? NonNullable<UnArray<A>> extends object
        ? // object return without args — just field selection
          ObjectFieldSelection<UnArray<NonNullable<A>>>
        : // scalar return without args — include or not
          boolean
      : NonNullable<UnArray<A>> extends object
        ? // object return with args — field selection and the args, optional if they all are
          ObjectFieldSelection<UnArray<NonNullable<A>>> & ArgsSelection<P>
        : undefined extends P
          ? // scalar return with optional args — include or not, or give the args
            boolean | ArgsSelection<P>
          : // scalar return with required args — only need args, no field selection
            { [argsKey]: P }
    : // non-function field — include or not
      boolean;
}>;

/**
 * Apply a selection to an object type, with `IdField` added wherever the type has it, as the
 * client adds it at runtime
 */
export type ApplySelection<
  Object,
  Selection,
  IdField extends string = never,
> = {
  [Key in (keyof Selection | IdField) & keyof Object]: Object[Key] extends (
    p: infer _RequestArgs,
  ) => infer FieldResponse
    ? DeriveNullability<
        FieldResponse,
        DeriveArrayType<
          NonNullable<FieldResponse>,
          ApplySelection<
            ExtractGQLTypeFromField<FieldResponse>,
            Key extends keyof Selection ? Selection[Key] : never,
            IdField
          >
        >
      >
    : Object[Key];
};

/**
 * What `subscribe` answers: the function that ends the subscription, which also carries it as
 * `unsubscribe`, so it serves Svelte's store contract and the observable one alike.
 */
export type Unsubscriber = (() => void) & { unsubscribe: () => void };

export type Subscribeable<Data> = {
  subscribe: (subscription: (value: Data) => void) => Unsubscriber;
};

type Response<
  Data,
  ForceReactivity extends boolean,
> = ForceReactivity extends true
  ? Promise<Subscribeable<Data>> & Subscribeable<Data | undefined>
  : // if this is a primitive type, we can't merge the Subscribeable with the Data type, therefore check for object type
    Data extends object
    ? Promise<Subscribeable<Data> & Data> & Subscribeable<Data | undefined>
    : Promise<Subscribeable<Data>> & Subscribeable<Data | undefined>;
