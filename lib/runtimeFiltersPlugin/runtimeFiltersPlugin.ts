import type { Span, Tracer } from "@opentelemetry/api";
import SchemaBuilder, {
  BasePlugin,
  type PothosOutputFieldConfig,
  type PothosTypeConfig,
  type SchemaTypes,
} from "@pothos/core";
import type { GraphQLFieldResolver } from "graphql";
import { type ApplyFiltersField, pluginName } from "./filterTypes";

export const applyFiltersKey = "applyFilters";

export class RuntimeFiltersPlugin<
  Types extends SchemaTypes,
> extends BasePlugin<Types> {
  private tracer?: Tracer;
  private tracerEnabled?: boolean;

  override onTypeConfig(typeConfig: PothosTypeConfig) {
    this.tracer = this.builder.options.otel?.tracer;
    this.tracerEnabled = this.builder.options.otel?.enabled;
    return typeConfig;
  }

  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types["Context"], object> {
    return async (parent, args, context, info) => {
      //TODO: https://github.com/hayes/pothos/discussions/1431#discussioncomment-12974130
      let filters: ApplyFiltersField<Types["Context"], any> | undefined;
      const fieldType = fieldConfig?.type as any;

      if (fieldType.kind === "List") {
        filters =
          fieldType.type?.ref.currentConfig.pothosOptions[applyFiltersKey];
      } else if (fieldType.kind === "Object") {
        filters = fieldType.ref.currentConfig.pothosOptions[applyFiltersKey];
      }

      if (!filters || !Array.isArray(filters) || filters.length === 0) {
        // if no filter should be applied, just continue
        return resolver(parent, args, context, info);
      }

      const runFilters = async (span?: Span) => {
        const allFilters = Array.isArray(filters) ? filters : [filters];
        span?.setAttribute("filters.total", allFilters.length);

        // TODO: find out if the aggrefagation across relation and then parallel execution is possible
        const prefetchedFiltersPromises = Promise.all(
          allFilters.map(async (filter) => {
            if (filter.prefetch) {
              const prefetched = await filter.prefetch({ context });
              return ({
                context,
                entities,
              }: {
                context: Types["Context"];
                entities: any;
              }) => filter.filter({ context, entities, prefetched });
            }
            return ({
              context,
              entities,
            }: {
              context: Types["Context"];
              entities: any;
            }) => filter.filter({ context, entities } as any);
          }),
        );

        const [resolved, prefetchedFilters] = await Promise.all([
          resolver(parent, args, context, info),
          prefetchedFiltersPromises,
        ]);

        const allowed = Array.from(
          (
            await Promise.all(
              prefetchedFilters.map((f) =>
                f({
                  context,
                  entities: Array.isArray(resolved)
                    ? resolved
                    : ([resolved] as any),
                }),
              ),
            )
          ).reduce((acc, val) => {
            for (const element of val) {
              acc.add(element);
            }
            return acc;
            // since multiple helpers might return the same entity we use a set to deduplicate
          }, new Set()),
        );

        span?.setAttribute("filters.allowed", allowed.length);

        // if the original value was an array, return an array
        if (Array.isArray(resolved)) {
          return allowed;
        }

        // if the original value was a single value, return the first allowed
        // or null if not allowed
        return allowed[0] ?? null;
      };

      if (this.tracer && this.tracerEnabled) {
        return this.tracer.startActiveSpan(
          `apply_filters_${fieldConfig.name}`,
          async (span) => {
            try {
              return await runFilters(span);
            } finally {
              span.end();
            }
          },
        );
      } else {
        return runFilters();
      }
    };
  }
}

let registered = false;
export function registerRuntimeFiltersPlugin() {
  if (!registered) {
    SchemaBuilder.registerPlugin(pluginName, RuntimeFiltersPlugin);
    registered = true;
  }
}
