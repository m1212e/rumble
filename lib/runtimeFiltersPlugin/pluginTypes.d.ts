import type { Tracer } from "@opentelemetry/api";
import type { SchemaTypes } from "@pothos/core";
import type { RumbleLogger } from "../types/rumbleInput";
import type { pluginName } from "./filterTypes";
import type {
  applyFiltersKey,
  RuntimeFiltersPlugin,
} from "./runtimeFiltersPlugin";

declare global {
  export namespace PothosSchemaTypes {
    export interface Plugins<Types extends SchemaTypes> {
      [pluginName]: RuntimeFiltersPlugin<Types>;
    }

    export interface SchemaBuilderOptions<Types extends SchemaTypes> {
      otel?: {
        enabled?: boolean;
        tracer?: Tracer;
      };
      logger?: {
        enabled?: boolean;
        logger: RumbleLogger;
      };
    }

    // export interface BuildSchemaOptions<Types extends SchemaTypes> {
    //   customBuildTimeOptions?: boolean;
    // }

    export interface ObjectTypeOptions<Types extends SchemaTypes, Shape> {
      //TOOD use proper type not any
      [applyFiltersKey]?: ApplyFiltersField<Types["Context"], any>;
    }

    // export interface MutationFieldOptions<
    // 	Types extends SchemaTypes,
    // 	Type extends TypeParam<Types>,
    // 	Nullable extends FieldNullability<Type>,
    // 	Args extends InputFieldMap,
    // 	ResolveReturnShape,
    // > {
    // 	[applyChecksKey]?: RegisteredChecks;
    // }
  }
}
