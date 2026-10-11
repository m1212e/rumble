export type MaskColumns<Context> = (p: {
  context: Context;
  entities: unknown[];
  action?: string;
}) => void | Promise<void>;

export const maskColumnsKey = "maskColumns";

export const maskColumnsActionKey = "maskColumnsAction";

// masking keeps primary keys on the row, their fields return null instead
export type MaskPrimaryKeys<Context> = {
  fields: string[];
  isHidden: (context: Context, row: object) => boolean;
};

export const maskPrimaryKeysKey = "maskPrimaryKeys";

// A relation joins on columns of the row. If masking hid them, the related
// rows are not the row's to see: the field returns null (or an empty list).
export type MaskRelations<Context> = {
  fields: Record<string, { many: boolean; sourceColumns: string[] }>;
  isHidden: (context: Context, row: object, columns: string[]) => boolean;
};

export const maskRelationsKey = "maskRelations";

export const columnMaskPluginName = "ColumnMaskPlugin" as const;
