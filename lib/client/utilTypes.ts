export type UnArray<T> = T extends Array<infer U> ? U : T;

export type UnFunc<T> = T extends () => infer A ? A : T;

export type UnArrayFields<T> = {
  [K in keyof T]: T[K] extends Array<any> ? UnArray<T[K]> : T[K];
};

export type RequireAtLeastOneFieldSet<T> = {
  [K in keyof T]: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];
