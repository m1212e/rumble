import type { Span, Tracer } from "@opentelemetry/api";
import SchemaBuilder, {
  BasePlugin,
  type PothosOutputFieldConfig,
  type PothosTypeConfig,
  type SchemaTypes,
} from "@pothos/core";
import DataLoader from "dataloader";
import type { GraphQLFieldResolver } from "graphql";
import { errorLogField } from "../helpers/errorLogging";
import {
  ATTR_FIELD_NAME,
  ATTR_FILTERS_ALLOWED,
  ATTR_FILTERS_TOTAL,
  recordSpanError,
  SPAN_FILTERS_APPLY,
  SPAN_FILTERS_RESOLVE,
  type TelemetryConfig,
  traceCorrelationFields,
} from "../helpers/telemetry";
import type { RumbleLogger } from "../types/rumbleInput";
import {
  type ApplyFiltersField,
  type FilterPrefetchCombo,
  pluginName,
} from "./filterTypes";

export const applyFiltersKey = "applyFilters";

type AnyFilterCombo = FilterPrefetchCombo<any, any, any>;

export class RuntimeFiltersPlugin<
  Types extends SchemaTypes,
> extends BasePlugin<Types> {
  private tracer?: Tracer;
  private tracerEnabled?: boolean;
  private logger?: RumbleLogger;
  private telemetryConfig: TelemetryConfig = {};

  // graphql-js resolves a relation field once per sibling in a list, concurrently,
  // so without this a filter like "can read user" would fire once per row instead
  // of once for the whole list. Keying loaders by context means they get garbage
  // collected once the request is done, no manual cleanup needed.
  private filterLoaders = new WeakMap<
    object,
    Map<AnyFilterCombo, DataLoader<any, any>>
  >();

  private getLoader(
    context: Types["Context"],
    filter: AnyFilterCombo,
  ): DataLoader<any, any> {
    let perContext = this.filterLoaders.get(context as object);
    if (!perContext) {
      perContext = new Map();
      this.filterLoaders.set(context as object, perContext);
    }

    let loader = perContext.get(filter);
    if (!loader) {
      // not awaited here on purpose, so it runs alongside the resolver instead of after it
      const prefetchPromise = filter.prefetch
        ? filter.prefetch({ context })
        : undefined;

      loader = new DataLoader<any, any>(
        async (entities) => {
          const prefetched = prefetchPromise
            ? await prefetchPromise
            : undefined;
          const allowed = await filter.filter({
            context,
            entities: entities as any[],
            prefetched,
          } as any);
          const allowedSet = new Set(allowed);
          return entities.map((entity) =>
            allowedSet.has(entity) ? entity : null,
          );
        },
        // cache off on purpose, we only want the batching, filters should still
        // run fresh every time like before
        { cache: false },
      );
      perContext.set(filter, loader);
    }

    return loader;
  }

  override onTypeConfig(typeConfig: PothosTypeConfig) {
    this.tracer = this.builder.options.otel?.tracer;
    this.tracerEnabled = this.builder.options.otel?.enabled;
    this.logger = this.builder.options.logger?.enabled
      ? this.builder.options.logger.logger
      : undefined;
    this.telemetryConfig = {
      otel: this.builder.options.otel,
      logger: this.builder.options.logger,
    };
    return typeConfig;
  }

  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types["Context"], object> {
    return async (parent, args, context, info) => {
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
        span?.setAttribute(ATTR_FILTERS_TOTAL, allFilters.length);

        const loaders = allFilters.map((filter) =>
          this.getLoader(context, filter as AnyFilterCombo),
        );

        let resolved: any;

        if (this.tracer && this.tracerEnabled) {
          resolved = await this.tracer.startActiveSpan(
            SPAN_FILTERS_RESOLVE,
            async (span) => {
              span.setAttribute(ATTR_FIELD_NAME, fieldConfig.name);
              try {
                return await resolver(parent, args, context, info);
              } catch (error) {
                recordSpanError(span, error);
                throw error;
              } finally {
                span.end();
              }
            },
          );
        } else {
          resolved = await resolver(parent, args, context, info);
        }

        const entities: any[] = Array.isArray(resolved) ? resolved : [resolved];

        // load() instead of loadMany() so a thrown filter still rejects here
        // instead of getting swallowed into an Error value
        const perFilterResults = await Promise.all(
          loaders.map((loader) =>
            Promise.all(entities.map((entity) => loader.load(entity))),
          ),
        );

        const allowed = entities.filter((_, index) =>
          perFilterResults.some((results) => results[index] != null),
        );

        span?.setAttribute(ATTR_FILTERS_ALLOWED, allowed.length);
        this.logger?.debug(
          {
            [ATTR_FIELD_NAME]: fieldConfig.name,
            [ATTR_FILTERS_TOTAL]: allFilters.length,
            [ATTR_FILTERS_ALLOWED]: allowed.length,
            ...traceCorrelationFields(this.telemetryConfig),
          },
          "runtime filters applied",
        );

        // if the original value was an array, return an array
        if (Array.isArray(resolved)) {
          return allowed;
        }

        // if the original value was a single value, return the first allowed
        // or null if not allowed
        return allowed[0] ?? null;
      };

      const logFilterError = (error: unknown) => {
        this.logger?.error(
          {
            [ATTR_FIELD_NAME]: fieldConfig.name,
            ...traceCorrelationFields(this.telemetryConfig),
            ...errorLogField(error),
          },
          "runtime filter threw",
        );
      };

      if (this.tracer && this.tracerEnabled) {
        return this.tracer.startActiveSpan(SPAN_FILTERS_APPLY, async (span) => {
          span.setAttribute(ATTR_FIELD_NAME, fieldConfig.name);
          try {
            return await runFilters(span);
          } catch (error) {
            logFilterError(error);
            recordSpanError(span, error);
            throw error;
          } finally {
            span.end();
          }
        });
      } else {
        try {
          return await runFilters();
        } catch (error) {
          logFilterError(error);
          throw error;
        }
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
