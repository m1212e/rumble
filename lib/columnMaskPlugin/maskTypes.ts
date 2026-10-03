export type MaskColumns<Context> = (p: {
  context: Context;
  entities: unknown[];
  action?: string;
}) => void | Promise<void>;

export const maskColumnsKey = "maskColumns";

export const maskColumnsActionKey = "maskColumnsAction";

export const columnMaskPluginName = "ColumnMaskPlugin" as const;
