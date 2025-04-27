import type {
	FieldNullability,
	InputFieldMap,
	SchemaTypes,
	TypeParam,
} from "@pothos/core";

import type {
	ExplicitChecksPlugin,
	applyChecksKey,
} from "./explicitChecksPlugin";
import pluginName from "./explicitChecksPlugin";

export type CheckerResponse = boolean | Promise<boolean>;
export type SingleChecker<Context, T> = (p: {
	context: Context;
	entity: T;
}) => CheckerResponse;

export type MultiChecker<Context, T> = (p: {
	context: Context;
	entity: T[];
}) => CheckerResponse;

export type Checker<Context, T> =
	| { checker: SingleChecker<Context, T>; type: "single" }
	| { checker: MultiChecker<Context, T>; type: "multi" };

export type ApplyChecksField<Context, T> =
	| Checker<Context, T>
	| Checker<Context, T>[]
	| undefined;

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
			//TOOD use proper type not any
			[applyChecksKey]?: ApplyChecksField<Types["Context"], any>;
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
