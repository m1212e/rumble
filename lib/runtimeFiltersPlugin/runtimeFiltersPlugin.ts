import type { Span, Tracer } from "@opentelemetry/api";
import SchemaBuilder, {
  BasePlugin,
  type PothosOutputFieldConfig,
  type PothosTypeConfig,
  type SchemaTypes,
} from "@pothos/core";
import type { GraphQLFieldResolver } from "graphql";
import { applyFilters } from "../helpers/applyFilters";
import { type ApplyFiltersField, pluginName } from "./filterTypes";

export const applyFiltersKey = "applyFilters";

export class RuntimeFiltersPlugin<
  Types extends SchemaTypes,
> extends BasePlugin<Types> {
  private tracer?: Tracer;
  override onTypeConfig(typeConfig: PothosTypeConfig) {
    this.tracer = this.builder.options.otelTracer;
    return typeConfig;
  }

  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types["Context"], object> {
    return async (parent, args, context, info) => {
      const runFilters = async (span?: Span) => {
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
          span?.setAttribute("filters.status", "unrestricted");
          // if no filter should be applied, just continue
          return resolver(parent, args, context, info);
        }

        const resolved = await resolver(parent, args, context, info);
        const allResolvedValues = Array.isArray(resolved)
          ? resolved
          : [resolved];
        const allFilters = Array.isArray(filters) ? filters : [filters];
        span?.setAttribute("filters.total", allFilters.length);

        const allowed = await applyFilters({
          filters: allFilters,
          entities: allResolvedValues,
          context,
        });
        span?.setAttribute("filters.allowed", allowed.length);

        // if the original value was an array, return an array
        if (Array.isArray(resolved)) {
          return allowed;
        }

        // if the original value was a single value, return the first allowed
        // or null if not allowed
        return allowed[0] ?? null;
      };

      if (this.tracer) {
        return this.tracer.startActiveSpan(
          `apply_filters_${fieldConfig.name}`,
          async (span) => {
            try {
              return await runFilters();
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
