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

export const columnMaskPluginName = "ColumnMaskPlugin" as const;
