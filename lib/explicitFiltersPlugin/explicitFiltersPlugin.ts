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
import type { ApplyFiltersField } from "./pluginTypes";

const pluginName = "ManualFiltersPlugin";

export default pluginName;

export const applyFiltersKey = "applyFilters";

export class ManualFiltersPlugin<
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
			const filters: ApplyFiltersField<Types["Context"], any> = (
				fieldConfig?.type as any
			).type?.ref.currentConfig.pothosOptions[applyFiltersKey];

			// if no filter should be applied, just continue
			if (!filters) {
				return resolver(parent, args, context, info);
			}

			const resolved = await resolver(parent, args, context, info);
			const allResolvedValues = Array.isArray(resolved) ? resolved : [resolved];
			const allFilters = Array.isArray(filters) ? filters : [filters];

			const allowed = (
				await Promise.all(
					allFilters.map((filter) =>
						filter({
							context,
							entities: allResolvedValues,
						}),
					),
				)
			).reduce((acc, val) => {
				acc.push(...val);
				return acc;
			}, []);

			// if the original value was an array, return an array
			if (Array.isArray(resolved)) {
				return allowed;
			}

			// if the original value was a single value, return the first allowed
			// or null if not allowed
			return allowed[0] ?? null;
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

SchemaBuilder.registerPlugin(pluginName, ManualFiltersPlugin);
