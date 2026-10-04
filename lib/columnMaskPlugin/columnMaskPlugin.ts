import {
  BasePlugin,
  isThenable,
  type PothosOutputFieldConfig,
  type SchemaTypes,
} from "@pothos/core";
import type { GraphQLFieldResolver } from "graphql";
import { hiddenPrimaryKeyKey } from "../abilityBuilder/keys";
import { objectTypeOptionsOfField } from "../helpers/objectTypeOptions";
import { registerPluginOnce } from "../helpers/registerPlugin";
import {
  columnMaskPluginName,
  type MaskColumns,
  maskColumnsActionKey,
  maskColumnsKey,
  maskPrimaryKeysKey,
} from "./maskTypes";

export class ColumnMaskPlugin<
  Types extends SchemaTypes,
> extends BasePlugin<Types> {
  // fallow-ignore-next-line unused-class-member
  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types["Context"], object> {
    return this.maskResult(
      this.maskPrimaryKey(resolver, fieldConfig),
      fieldConfig,
    );
  }

  // masking keeps primary keys on the row, the fields returning them hide them
  private maskPrimaryKey(
    resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types["Context"], object> {
    const primaryKeys = (
      this.buildCache.getTypeConfig(fieldConfig.parentType).pothosOptions as {
        [maskPrimaryKeysKey]?: string[];
      }
    )[maskPrimaryKeysKey];
    if (!primaryKeys?.includes(fieldConfig.name)) return resolver;

    return (parent, args, context, info) =>
      (parent as any)?.[hiddenPrimaryKeyKey]
        ? null
        : resolver(parent, args, context, info);
  }

  private maskResult(
    resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types["Context"], object> {
    const maskColumns = objectTypeOptionsOfField(
      this.buildCache,
      fieldConfig,
    )?.[maskColumnsKey] as MaskColumns<Types["Context"]> | undefined;
    if (!maskColumns) return resolver;
    const action = (
      fieldConfig.pothosOptions as { [maskColumnsActionKey]?: string }
    )[maskColumnsActionKey];

    const mask = (value: unknown, context: Types["Context"]): unknown => {
      if (value == null) return value;
      // graphql-js accepts lists of promises, the rows are masked once resolved
      if (Array.isArray(value) && value.some(isThenable)) {
        return Promise.all(value).then((rows) => mask(rows, context));
      }
      const pending = maskColumns({
        context,
        entities: Array.isArray(value) ? value : [value],
        action,
      });
      return pending ? pending.then(() => value) : value;
    };

    return (parent, args, context, info) => {
      const resolved = resolver(parent, args, context, info);
      return isThenable(resolved)
        ? resolved.then((value) => mask(value, context))
        : mask(resolved, context);
    };
  }
}

export function registerColumnMaskPlugin() {
  registerPluginOnce(columnMaskPluginName, ColumnMaskPlugin);
}
