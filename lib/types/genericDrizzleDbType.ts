import type { DrizzleClient } from "@pothos/plugin-drizzle";

export type QueryConditionObject = {
  where: any;
  columns: any;
};

export type GenericDrizzleDbTypeConstraints = {
  query: {
    [key: string]: {
      findMany: (P: QueryConditionObject) => any;
    };
  };
} & DrizzleClient;
