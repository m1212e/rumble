export type Prefetch<Context, ReturnType> = (params: {
  context: Context;
}) => Promise<ReturnType>;

export type Filter<
  Context,
  FilteredEntityType,
  PrefetchReturnType = never,
> = (p: {
  context: Context;
  entities: FilteredEntityType[];
  prefetched: PrefetchReturnType;
}) => FilteredEntityType[] | Promise<FilteredEntityType[]>;

export type FilterPrefetchCombo<
  Context,
  FilteredEntityType,
  PrefetchReturnType = never,
> = {
  filter: Filter<Context, FilteredEntityType, PrefetchReturnType>;
  prefetch?: Prefetch<Context, PrefetchReturnType>;
};

export type ApplyFiltersField<Context, T> =
  | FilterPrefetchCombo<Context, T>
  | FilterPrefetchCombo<Context, T>[]
  | undefined;

export const pluginName = "RuntimeFiltersPlugin" as const;
