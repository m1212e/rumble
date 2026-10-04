import type {
  FieldNullability,
  InputFieldMap,
  SchemaTypes,
  TypeParam,
} from "@pothos/core";
import type { ColumnMaskPlugin } from "./columnMaskPlugin";
import type {
  columnMaskPluginName,
  MaskColumns,
  maskColumnsActionKey,
  maskColumnsKey,
  maskPrimaryKeysKey,
} from "./maskTypes";

declare global {
  export namespace PothosSchemaTypes {
    export interface Plugins<Types extends SchemaTypes> {
      [columnMaskPluginName]: ColumnMaskPlugin<Types>;
    }

    export interface ObjectTypeOptions<Types extends SchemaTypes, Shape> {
      [maskColumnsKey]?: MaskColumns<Types["Context"]>;
      [maskPrimaryKeysKey]?: string[];
    }

    export interface FieldOptions<
      Types extends SchemaTypes,
      ParentShape,
      Type extends TypeParam<Types>,
      Nullable extends FieldNullability<Type>,
      Args extends InputFieldMap,
      ResolveShape,
      ResolveReturnShape,
    > {
      [maskColumnsActionKey]?: string;
    }
  }
}
