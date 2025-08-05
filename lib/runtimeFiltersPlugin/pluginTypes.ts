import type { SchemaTypes } from "@pothos/core";

import type {
	applyFiltersKey,
	ManualFiltersPlugin,
} from "./runtimeFiltersPlugin";
import pluginName from "./runtimeFiltersPlugin";

export type Filter<Context, T> = (p: {
	context: Context;
	entities: T[];
}) => T[] | Promise<T[]>;

export type ApplyFiltersField<Context, T> =
	| Filter<Context, T>
	| Filter<Context, T>[]
	| undefined;

declare global {
	export namespace PothosSchemaTypes {
		export interface Plugins<Types extends SchemaTypes> {
			[pluginName]: ManualFiltersPlugin<Types>;
		}

		// export interface SchemaBuilderOptions<Types extends SchemaTypes> {
		//   optionInRootOfConfig?: boolean;
		//   nestedOptionsObject?: ExamplePluginOptions;
		// }

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
