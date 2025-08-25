import {
	type GraphQLArgument,
	GraphQLEnumType,
	GraphQLInputObjectType,
	type GraphQLInputType,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	type GraphQLOutputType,
	GraphQLScalarType,
} from "graphql";

type GraphQLType =
	| GraphQLObjectType<any, any>
	| GraphQLEnumType
	| GraphQLInputObjectType
	| GraphQLScalarType;

export function makeTSRepresentation(model: GraphQLType) {
	if (model instanceof GraphQLObjectType) {
		return makeTSTypeFromObject(model);
	} else if (model instanceof GraphQLScalarType) {
		return mapGraphqlScalarToTSTypeString(model);
	} else if (model instanceof GraphQLEnumType) {
		return makeStringLiteralUnionFromEnum(model);
	} else if (model instanceof GraphQLInputObjectType) {
		return makeTSTypeFromInputObject(model);
	}
}

function makeTSTypeFromObject(model: GraphQLObjectType) {
	const stringifiedFields = new Map<string, string>();
	for (const [key, value] of Object.entries(model.getFields())) {
		stringifiedFields.set(key, makeTSObjectTypeField(value.type, value.args));
	}

	return `{
  ${stringifiedFields
		.entries()
		.map(([key, value]) => `${key}: ${value}`)
		.toArray()
		.join(",\n  ")}    
}`;
}

function makeTSTypeFromInputObject(model: GraphQLInputObjectType) {
	const stringifiedFields = new Map<string, string>();
	for (const [key, value] of Object.entries(model.getFields())) {
		stringifiedFields.set(key, makeTSInputObjectTypeField(value.type));
	}

	return `{
  ${stringifiedFields
		.entries()
		.map(
			([key, value]) =>
				`${key}${value.includes("| undefined") ? "?" : ""}: ${value}`,
		)
		.toArray()
		.join(",\n  ")}    
}`;
}

function makeTSObjectTypeField(
	returnType: GraphQLOutputType,
	args?: readonly GraphQLArgument[],
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

	const isRelationType = returnType instanceof GraphQLObjectType;

	const argsStringMap = new Map<string, string>();

	for (const arg of args ?? []) {
		argsStringMap.set(arg.name, stringifyTSObjectArg(arg.type));
	}

	if (isRelationType) {
		const makePOptional = argsStringMap
			.entries()
			.every(([, value]) => value.includes("| undefined"));
		const argsString =
			(args ?? []).length > 0
				? `p${makePOptional ? "?" : ""}: {
  ${argsStringMap
		.entries()
		.map(
			([key, value]) =>
				`  ${key}${value.includes("| undefined") ? "?" : ""}: ${value}`,
		)
		.toArray()
		.join(",\n  ")}
  }`
				: "";

		return `(${argsString}) => ${returnTypeString}`;
	} else {
		return returnTypeString;
	}
}

function makeTSInputObjectTypeField(returnType: GraphQLInputType) {
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
		returnTypeString += " | null | undefined";
	} else if (isList) {
		returnTypeString += " | undefined";
	}

	return returnTypeString;
}

function stringifyTSObjectArg(arg: any) {
	let ret = "unknown";
	let isNullable = true;

	if (arg instanceof GraphQLNonNull) {
		isNullable = false;
		arg = arg.ofType;
	}

	if (
		arg instanceof GraphQLInputObjectType ||
		arg instanceof GraphQLScalarType
	) {
		ret = arg.name;
	}

	if (isNullable) {
		ret += " | null | undefined"; // we also want undefined in args
	}

	return ret;
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

function makeStringLiteralUnionFromEnum(enumType: GraphQLEnumType) {
	return enumType
		.getValues()
		.map((value) => `"${value.name}"`)
		.join(" | ");
}
