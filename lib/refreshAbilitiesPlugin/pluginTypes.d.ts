import type { SchemaTypes } from "@pothos/core";
import type {
  RefreshAbilitiesPlugin,
  refreshAbilitiesPluginName,
} from "./refreshAbilitiesPlugin";

declare global {
  export namespace PothosSchemaTypes {
    export interface Plugins<Types extends SchemaTypes> {
      [refreshAbilitiesPluginName]: RefreshAbilitiesPlugin<Types>;
    }
  }
}
