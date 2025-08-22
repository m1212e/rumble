import {
	type GraphQLArgument,
	type GraphQLEnumType,
	GraphQLInputObjectType,
	GraphQLList,
	GraphQLNonNull,
	type GraphQLObjectType,
	type GraphQLOutputType,
	GraphQLScalarType,
} from "graphql";

export type ModelFieldType =
	| GraphQLObjectType<any, any>
	| GraphQLEnumType
	| GraphQLInputObjectType
	| GraphQLScalarType;

export function makeModel(model: GraphQLObjectType) {
	// const response = ""
	// const args = model.getFields()

	const stringifiedFields = new Map<string, string>();
	for (const [key, value] of Object.entries(model.getFields())) {
		stringifiedFields.set(key, makeField(value.args, value.type));
	}

	// const fieldMap = new Map();

	// for (const [key, value] of Object.entries(fields)) {
	// 	fieldMap.set(key, value.type.toString());
	// }

	return `{
  ${stringifiedFields
		.entries()
		.map(([key, value]) => `${key}: ${value}`)
		.toArray()
		.join(",\n  ")}    
}`;
}

function makeField(
	args: readonly GraphQLArgument[],
	returnType: GraphQLOutputType,
) {
	let isNonNullReturnType = false;
	let isList = false;

	for (let index = 0; index < 3; index++) {
		if (returnType instanceof GraphQLList) {
			isList = true;
			returnType = returnType.ofType;
		}

		if (returnType instanceof GraphQLNonNull) {
			isNonNullReturnType = true;
			returnType = returnType.ofType;
		}
	}

	let returnTypeString = (returnType as any).name;

	if (isList) {
		returnTypeString += "[]";
	}

	if (!isNonNullReturnType) {
		returnTypeString += " | null";
	}

	const argsStringMap = new Map<string, string>();
	for (const arg of args) {
		argsStringMap.set(arg.name, stringifyArg(arg.type));
	}

	const argsString =
		args.length > 0
			? `{
  ${argsStringMap
		.entries()
		.map(([key, value]) => `  ${key}: ${value}`)
		.toArray()
		.join(",\n  ")}
  }`
			: "";

	return `(${argsString}) => ${returnTypeString}`;
}

function stringifyArg(arg: any) {
	if (arg instanceof GraphQLInputObjectType) {
		return arg.name;
	}

	if (arg instanceof GraphQLScalarType) {
		return mapGraphqlScalarToTSTypeString(arg);
	}

	console.warn("Unknown arg type", arg);
	return "unknown";
}

function mapGraphqlScalarToTSTypeString(arg: any) {
	switch (arg.name) {
		case "ID":
			return "string";

		case "String":
			return "string";

		case "Boolean":
			return "boolean";

		case "Int":
			return "number";

		case "Float":
			return "number";

		case "Date":
			return "Date";

		case "DateTime":
			return "Date";

		case "JSON":
			return "any";

		default:
			return "unknown";
	}
}
