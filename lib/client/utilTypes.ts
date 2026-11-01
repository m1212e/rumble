import type { argsKey } from "./request";

/**
 * The `__args` a selection of a field takes, from the parameter `P` of the field's generated
 * function: none for a field without arguments (`() => X` infers `unknown`), optional when every
 * argument is optional (`(p?: A) => X` infers `A | undefined`), required otherwise. Checking
 * `P extends Record<string, any>` alone misses the optional case, whose `undefined` fails it, and
 * then leaves `__args` unchecked.
 */
export type ArgsSelection<P> = unknown extends P
  ? unknown
  : undefined extends P
    ? { [argsKey]?: NonNullable<P> }
    : { [argsKey]: P };

export type UnArray<T> = T extends Array<infer U> ? U : T;

export type UnFunc<T> = T extends () => infer A ? A : T;

export type ExtractGQLTypeFromField<T> = NonNullable<UnArray<UnFunc<T>>>;

export type DeriveArrayType<From, To> = From extends Array<any> ? To[] : To;
export type DeriveNullability<From, To> = From extends null ? To | null : To;

export type RequireAtLeastOneFieldSet<T> = {
  [K in keyof T]: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];
