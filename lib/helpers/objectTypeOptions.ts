import type {
  BuildCache,
  PothosOutputFieldConfig,
  SchemaTypes,
} from "@pothos/core";

export function objectTypeOptionsOfField<Types extends SchemaTypes>(
  buildCache: BuildCache<Types>,
  fieldConfig: PothosOutputFieldConfig<Types>,
): Record<string, unknown> | undefined {
  const type = fieldConfig.type as any;
  const ref =
    type.kind === "List"
      ? type.type.kind === "Object"
        ? type.type.ref
        : undefined
      : type.kind === "Object"
        ? type.ref
        : undefined;
  if (!ref) return undefined;

  return buildCache.getTypeConfig(ref, "Object").pothosOptions as Record<
    string,
    unknown
  >;
}
