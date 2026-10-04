import SchemaBuilder, {
  BasePlugin,
  isThenable,
  type PothosOutputFieldConfig,
  type SchemaTypes,
} from "@pothos/core";
import type { GraphQLFieldResolver } from "graphql";
import { objectTypeOptionsOfField } from "../helpers/objectTypeOptions";
import {
  columnMaskPluginName,
  type MaskColumns,
  maskColumnsActionKey,
  maskColumnsKey,
} from "./maskTypes";

export class ColumnMaskPlugin<
  Types extends SchemaTypes,
> extends BasePlugin<Types> {
  // fallow-ignore-next-line unused-class-member
  override wrapResolve(
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

    const mask = (value: unknown, context: Types["Context"]) => {
      if (value == null) return value;
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

let registered = false;
export function registerColumnMaskPlugin() {
  if (!registered) {
    SchemaBuilder.allowPluginReRegistration = true;
    SchemaBuilder.registerPlugin(columnMaskPluginName, ColumnMaskPlugin);
    registered = true;
  }
}
