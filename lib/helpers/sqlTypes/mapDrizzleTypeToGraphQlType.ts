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
  isArray,
}: {
  builder: Builder;
  sqlType: PossibleSQLType;
  fieldName: string;
  nullable: boolean;
  isArray: boolean;
}) {
  const gqlType = mapSQLTypeToGraphQLType({
    sqlType,
    fieldName,
  });
  switch (gqlType) {
    case "Int":
      return isArray
        ? builder.exposeIntList(fieldName, { nullable: nullable as any })
        : builder.exposeInt(fieldName, { nullable });
    case "BigInt":
      return builder.field({
        type: isArray ? ["BigInt"] : "BigInt",
        resolve: (element: any) => element[fieldName],
        nullable,
      });
    case "String":
      return isArray
        ? builder.exposeStringList(fieldName, { nullable: nullable as any })
        : builder.exposeString(fieldName, { nullable });
    case "Boolean":
      return isArray
        ? builder.exposeBooleanList(fieldName, { nullable: nullable as any })
        : builder.exposeBoolean(fieldName, { nullable });
    case "Date":
      return builder.field({
        type: isArray ? ["Date"] : "Date",
        resolve: (element: any) => element[fieldName],
        nullable,
      });
    case "DateTime":
      return builder.field({
        type: isArray ? ["DateTime"] : "DateTime",
        // Drizzle's timestamp({ mode: "string" }) returns a string; the
        // DateTimeISO scalar expects a Date object, so coerce when needed.
        resolve: (element: any) => {
          const v = element[fieldName];
          if (v == null) return v;
          return v instanceof Date ? v : new Date(v);
        },
        nullable,
      });
    case "Float":
      return isArray
        ? builder.exposeFloatList(fieldName, { nullable: nullable as any })
        : builder.exposeFloat(fieldName, { nullable });
    case "ID":
      return isArray
        ? builder.exposeIDList(fieldName, { nullable: nullable as any })
        : builder.exposeID(fieldName, { nullable });
    case "JSON":
      return builder.field({
        type: isArray ? ["JSON"] : "JSON",
        resolve: (element: any) => element[fieldName],
        nullable,
      });
    case "Bytes":
      return builder.field({
        type: "Bytes",
        resolve: (element: any) => {
          const v = element[fieldName];
          if (v == null) return v;
          return Buffer.isBuffer(v) ? v.toString("base64") : String(v);
        },
        nullable,
      });
    default:
      throw new RumbleError(
        `Unsupported object type ${gqlType} for column ${fieldName}`,
      );
  }
}
