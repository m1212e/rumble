export type Filter<Context, T> = (p: {
  context: Context;
  entities: T[];
}) => T[] | Promise<T[]>;

export type ApplyFiltersField<Context, T> =
  | Filter<Context, T>
  | Filter<Context, T>[]
  | undefined;

export const pluginName = "RuntimeFiltersPlugin" as const;
