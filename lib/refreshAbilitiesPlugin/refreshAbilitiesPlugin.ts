import {
  BasePlugin,
  type PothosOutputFieldConfig,
  type SchemaTypes,
} from "@pothos/core";
import type { GraphQLFieldResolver } from "graphql";
import { refreshAbilities } from "../abilityBuilder/refresh";
import { registerPluginOnce } from "../helpers/registerPlugin";

export const refreshAbilitiesPluginName = "RefreshAbilitiesPlugin" as const;

/**
 * Starts a new snapshot of the abilities (the `when()` callbacks and, with
 * `resolveRelationalRules`, the resolved relational rules) whenever a root
 * field (query, mutation or subscription event) starts to resolve, see
 * `refreshAbilities`. A mutation's second root field sees what the first
 * wrote, and a subscription event or a live query refetching sees the rows
 * related to the caller by now.
 */
export class RefreshAbilitiesPlugin<
  Types extends SchemaTypes,
> extends BasePlugin<Types> {
  // fallow-ignore-next-line unused-class-member
  override wrapResolve(
    resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): GraphQLFieldResolver<unknown, Types["Context"], object> {
    const { kind } = this.buildCache.getTypeConfig(fieldConfig.parentType);
    if (kind !== "Query" && kind !== "Mutation" && kind !== "Subscription") {
      return resolver;
    }
    return (parent, args, context, info) => {
      refreshAbilities((context as { abilities?: object })?.abilities);
      return resolver(parent, args, context, info);
    };
  }
}

export function registerRefreshAbilitiesPlugin() {
  registerPluginOnce(refreshAbilitiesPluginName, RefreshAbilitiesPlugin);
}
