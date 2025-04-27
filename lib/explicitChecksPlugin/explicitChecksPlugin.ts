import "./pluginTypes";
import SchemaBuilder, {
	BasePlugin,
	type PothosEnumValueConfig,
	type PothosInputFieldConfig,
	type PothosInterfaceTypeConfig,
	type PothosOutputFieldConfig,
	type PothosTypeConfig,
	type PothosUnionTypeConfig,
	type SchemaTypes,
} from "@pothos/core";
import type {
	GraphQLFieldResolver,
	GraphQLSchema,
	GraphQLTypeResolver,
} from "graphql";
import type { ApplyChecksField } from "./pluginTypes";

const pluginName = "ExplicitChecksPlugin";

export default pluginName;

export const applyChecksKey = "applyChecks";

export class ExplicitChecksPlugin<
	Types extends SchemaTypes,
> extends BasePlugin<Types> {
	//   override onTypeConfig(typeConfig: PothosTypeConfig) {
	//     // console.log(this.builder.options.nestedOptionsObject?.exampleOption);
	//     // console.log(this.options.customBuildTimeOptions);

	//     if (typeConfig.kind === 'Object') {
	//       console.log(typeConfig.pothosOptions.optionOnObject);
	//     }

	//     return typeConfig;
	//   }

	//   override onOutputFieldConfig(fieldConfig: PothosOutputFieldConfig<Types>) {
	//     if (fieldConfig.kind === 'Mutation') {
	//       console.log(fieldConfig.pothosOptions.customMutationFieldOption);
	//     }

	//     return fieldConfig;
	//   }

	//   override onInputFieldConfig(fieldConfig: PothosInputFieldConfig<Types>) {
	//     return fieldConfig;
	//   }

	//   override onEnumValueConfig(valueConfig: PothosEnumValueConfig<Types>) {
	//     return valueConfig;
	//   }

	//   override beforeBuild() {}

	//   override afterBuild(schema: GraphQLSchema): GraphQLSchema {
	//     return schema;
	//   }

	override wrapResolve(
		resolver: GraphQLFieldResolver<unknown, Types["Context"], object>,
		fieldConfig: PothosOutputFieldConfig<Types>,
	): GraphQLFieldResolver<unknown, Types["Context"], object> {
		return async (parent, args, context, info) => {
			const checkers: ApplyChecksField<Types["Context"], any> = (
				fieldConfig.type as any
			).ref.currentConfig.pothosOptions.applyChecks;

			if (!checkers) {
				return resolver(parent, args, context, info);
			}

			if (checkers) {
				if (Array.isArray(checkers)) {
					const results = await Promise.all(
						checkers.map((checker) => checker(context)),
					);
					if (results.some((result) => !result)) {
						return null;
					}
				} else {
					const result = await checkers(context);
					if (!result) {
						return null;
					}
				}
			}

			// TODO: optimize by only awaiting when checkers are placed
			return resolver(parent, args, context, info);
		};
	}

	//   override wrapSubscribe(
	//     subscribe: GraphQLFieldResolver<unknown, Types['Context'], object> | undefined,
	//     fieldConfig: PothosOutputFieldConfig<Types>,
	//   ) {
	//     return subscribe;
	//   }

	//   override wrapResolveType(
	//     resolveType: GraphQLTypeResolver<unknown, Types['Context']>,
	//     typeConfig: PothosInterfaceTypeConfig | PothosUnionTypeConfig,
	//   ) {
	//     return resolveType;
	//   }
}

SchemaBuilder.registerPlugin(pluginName, ExplicitChecksPlugin);
