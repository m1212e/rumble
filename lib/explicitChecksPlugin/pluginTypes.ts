import type {
	FieldNullability,
	InputFieldMap,
	SchemaTypes,
	TypeParam,
} from "@pothos/core";

import type {
	ExplicitChecksPlugin,
	RegisteredChecks,
	applyChecksKey,
} from "./explicitChecksPlugin";
import pluginName from "./explicitChecksPlugin";

declare global {
	export namespace PothosSchemaTypes {
		export interface Plugins<Types extends SchemaTypes> {
			[pluginName]: ExplicitChecksPlugin<Types>;
		}

		// export interface SchemaBuilderOptions<Types extends SchemaTypes> {
		//   optionInRootOfConfig?: boolean;
		//   nestedOptionsObject?: ExamplePluginOptions;
		// }

		// export interface BuildSchemaOptions<Types extends SchemaTypes> {
		//   customBuildTimeOptions?: boolean;
		// }

		export interface ObjectTypeOptions<Types extends SchemaTypes, Shape> {
			[applyChecksKey]?: RegisteredChecks<Types["Context"]>;
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
