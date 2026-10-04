export type MaskColumns<Context> = (p: {
  context: Context;
  entities: unknown[];
  action?: string;
}) => void | Promise<void>;

export const maskColumnsKey = "maskColumns";

export const maskColumnsActionKey = "maskColumnsAction";

// the fields of an object which return null when its row hides the primary key
export const maskPrimaryKeysKey = "maskPrimaryKeys";

export const columnMaskPluginName = "ColumnMaskPlugin" as const;
