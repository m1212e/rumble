export type NumberWhereInputArgument = {
  eq?: number;
  ne?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: number[];
  notIn?: number[];
  like?: string;
  ilike?: string;
  notLike?: string;
  notIlike?: string;
  isNull?: boolean;
  isNotNull?: boolean;
  arrayOverlaps?: number[];
  arrayContained?: number[];
  arrayContains?: number[];
  AND?: NumberWhereInputArgument[];
  OR?: NumberWhereInputArgument[];
  NOT?: NumberWhereInputArgument;
};

export type StringWhereInputArgument = {
  eq?: string;
  ne?: string;
  gt?: string;
  gte?: string;
  lt?: string;
  lte?: string;
  in?: string[];
  notIn?: string[];
  like?: string;
  ilike?: string;
  notLike?: string;
  notIlike?: string;
  isNull?: boolean;
  isNotNull?: boolean;
  arrayOverlaps?: string[];
  arrayContained?: string[];
  arrayContains?: string[];
  AND?: StringWhereInputArgument[];
  OR?: StringWhereInputArgument[];
  NOT?: StringWhereInputArgument;
};

export type DateWhereInputArgument = {
  eq?: Date;
  ne?: Date;
  gt?: Date;
  gte?: Date;
  lt?: Date;
  lte?: Date;
  in?: Date[];
  notIn?: Date[];
  like?: string;
  ilike?: string;
  notLike?: string;
  notIlike?: string;
  isNull?: boolean;
  isNotNull?: boolean;
  arrayOverlaps?: Date[];
  arrayContained?: Date[];
  arrayContains?: Date[];
  AND?: DateWhereInputArgument[];
  OR?: DateWhereInputArgument[];
  NOT?: DateWhereInputArgument;
};

// TODO: Add proper type for schemaBuilder

export function implementDefaultWhereInputArgs(schemaBuilder: any) {
  const IntWhereInputArgument = schemaBuilder
    .inputRef("IntWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.int(),
        ne: t.int(),
        gt: t.int(),
        gte: t.int(),
        lt: t.int(),
        lte: t.int(),
        in: t.intList(),
        notIn: t.intList(),
        like: t.string(),
        ilike: t.string(),
        notLike: t.string(),
        notIlike: t.string(),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.intList(),
        arrayContained: t.intList(),
        arrayContains: t.intList(),
        AND: t.field({
          type: [IntWhereInputArgument],
        }),
        OR: t.field({
          type: [IntWhereInputArgument],
        }),
        NOT: t.field({
          type: IntWhereInputArgument,
        }),
      }),
    });

  const FloatWhereInputArgument = schemaBuilder
    .inputRef("FloatWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.float(),
        ne: t.float(),
        gt: t.float(),
        gte: t.float(),
        lt: t.float(),
        lte: t.float(),
        in: t.floatList(),
        notIn: t.floatList(),
        like: t.string(),
        ilike: t.string(),
        notLike: t.string(),
        notIlike: t.string(),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.floatList(),
        arrayContained: t.floatList(),
        arrayContains: t.floatList(),
        AND: t.field({
          type: [FloatWhereInputArgument],
        }),
        OR: t.field({
          type: [FloatWhereInputArgument],
        }),
        NOT: t.field({
          type: FloatWhereInputArgument,
        }),
      }),
    });

  const StringWhereInputArgument = schemaBuilder
    .inputRef("StringWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.string(),
        ne: t.string(),
        gt: t.string(),
        gte: t.string(),
        lt: t.string(),
        lte: t.string(),
        in: t.stringList(),
        notIn: t.stringList(),
        like: t.string(),
        ilike: t.string(),
        notLike: t.string(),
        notIlike: t.string(),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.stringList(),
        arrayContained: t.stringList(),
        arrayContains: t.stringList(),
        AND: t.field({
          type: [StringWhereInputArgument],
        }),
        OR: t.field({
          type: [StringWhereInputArgument],
        }),
        NOT: t.field({
          type: StringWhereInputArgument,
        }),
      }),
    });

  const DateWhereInputArgument = schemaBuilder
    .inputRef("DateWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.field({ type: "Date" }),
        ne: t.field({ type: "Date" }),
        gt: t.field({ type: "Date" }),
        gte: t.field({ type: "Date" }),
        lt: t.field({ type: "Date" }),
        lte: t.field({ type: "Date" }),
        in: t.field({ type: ["Date"] }),
        notIn: t.field({ type: ["Date"] }),
        like: t.string(),
        ilike: t.string(),
        notLike: t.string(),
        notIlike: t.string(),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.field({ type: ["Date"] }),
        arrayContained: t.field({ type: ["Date"] }),
        arrayContains: t.field({ type: ["Date"] }),
        AND: t.field({
          type: [DateWhereInputArgument],
        }),
        OR: t.field({
          type: [DateWhereInputArgument],
        }),
        NOT: t.field({
          type: DateWhereInputArgument,
        }),
      }),
    });
}
