import type { DrizzleObjectFieldBuilder } from "@pothos/plugin-drizzle";
import { RumbleError } from "../../types/rumbleError";
import { mapSQLTypeToGraphQLType } from "./mapSQLTypeToTSType";
import type { PossibleSQLType } from "./types";

export function buildPothosResponseTypeFromGraphQLType<
  Builder extends DrizzleObjectFieldBuilder<any, any, any, any>,
>({
  builder,
  sqlType,
  fieldName,
  nullable,
}: {
  builder: Builder;
  sqlType: PossibleSQLType;
  fieldName: string;
  nullable: boolean;
}) {
  const gqlType = mapSQLTypeToGraphQLType({
    sqlType,
    fieldName,
  });
  switch (gqlType) {
    case "Int":
      return builder.exposeInt(fieldName, { nullable });
    case "String":
      return builder.exposeString(fieldName, { nullable });
    case "Boolean":
      return builder.exposeBoolean(fieldName, { nullable });
    case "Date":
      return builder.field({
        type: "Date",
        resolve: (element: any) => element[fieldName],
        nullable,
      });
    case "DateTime":
      return builder.field({
        type: "DateTime",
        resolve: (element: any) => element[fieldName],
        nullable,
      });
    case "Float":
      return builder.exposeFloat(fieldName, { nullable });
    case "ID":
      return builder.exposeID(fieldName, { nullable });
    case "JSON":
      return builder.field({
        type: "JSON",
        resolve: (element: any) => element[fieldName],
        nullable,
      });
    default:
      throw new RumbleError(
        `Unsupported object type ${gqlType} for column ${fieldName}`,
      );
  }
}
