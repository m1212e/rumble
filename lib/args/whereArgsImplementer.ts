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

export type BooleanWhereInputArgument = {
  eq?: boolean;
  ne?: boolean;
  in?: boolean[];
  notIn?: boolean[];
  isNull?: boolean;
  isNotNull?: boolean;
  arrayOverlaps?: boolean[];
  arrayContained?: boolean[];
  arrayContains?: boolean[];
  AND?: BooleanWhereInputArgument[];
  OR?: BooleanWhereInputArgument[];
  NOT?: BooleanWhereInputArgument;
};

export type IDWhereInputArgument = {
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
  AND?: IDWhereInputArgument[];
  OR?: IDWhereInputArgument[];
  NOT?: IDWhereInputArgument;
};

export type JSONWhereInputArgument = {
  eq?: unknown;
  ne?: unknown;
  in?: unknown[];
  notIn?: unknown[];
  isNull?: boolean;
  isNotNull?: boolean;
  arrayOverlaps?: unknown[];
  arrayContained?: unknown[];
  arrayContains?: unknown[];
  AND?: JSONWhereInputArgument[];
  OR?: JSONWhereInputArgument[];
  NOT?: JSONWhereInputArgument;
};

export type BigIntWhereInputArgument = {
  eq?: bigint | number;
  ne?: bigint | number;
  gt?: bigint | number;
  gte?: bigint | number;
  lt?: bigint | number;
  lte?: bigint | number;
  in?: (bigint | number)[];
  notIn?: (bigint | number)[];
  isNull?: boolean;
  isNotNull?: boolean;
  AND?: BigIntWhereInputArgument[];
  OR?: BigIntWhereInputArgument[];
  NOT?: BigIntWhereInputArgument;
};

export type DateTimeWhereInputArgument = {
  eq?: Date;
  ne?: Date;
  gt?: Date;
  gte?: Date;
  lt?: Date;
  lte?: Date;
  in?: Date[];
  notIn?: Date[];
  isNull?: boolean;
  isNotNull?: boolean;
  arrayOverlaps?: Date[];
  arrayContained?: Date[];
  arrayContains?: Date[];
  AND?: DateTimeWhereInputArgument[];
  OR?: DateTimeWhereInputArgument[];
  NOT?: DateTimeWhereInputArgument;
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

  const BooleanWhereInputArgument = schemaBuilder
    .inputRef("BooleanWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.boolean(),
        ne: t.boolean(),
        in: t.booleanList(),
        notIn: t.booleanList(),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.booleanList(),
        arrayContained: t.booleanList(),
        arrayContains: t.booleanList(),
        AND: t.field({
          type: [BooleanWhereInputArgument],
        }),
        OR: t.field({
          type: [BooleanWhereInputArgument],
        }),
        NOT: t.field({
          type: BooleanWhereInputArgument,
        }),
      }),
    });

  const IDWhereInputArgument = schemaBuilder
    .inputRef("IDWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.id(),
        ne: t.id(),
        gt: t.id(),
        gte: t.id(),
        lt: t.id(),
        lte: t.id(),
        in: t.idList(),
        notIn: t.idList(),
        like: t.string(),
        ilike: t.string(),
        notLike: t.string(),
        notIlike: t.string(),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.idList(),
        arrayContained: t.idList(),
        arrayContains: t.idList(),
        AND: t.field({
          type: [IDWhereInputArgument],
        }),
        OR: t.field({
          type: [IDWhereInputArgument],
        }),
        NOT: t.field({
          type: IDWhereInputArgument,
        }),
      }),
    });

  const JSONWhereInputArgument = schemaBuilder
    .inputRef("JSONWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.field({ type: "JSON", required: false }),
        ne: t.field({ type: "JSON", required: false }),
        in: t.field({ type: ["JSON"], required: false }),
        notIn: t.field({ type: ["JSON"], required: false }),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.field({ type: ["JSON"], required: false }),
        arrayContained: t.field({ type: ["JSON"], required: false }),
        arrayContains: t.field({ type: ["JSON"], required: false }),
        AND: t.field({
          type: [JSONWhereInputArgument],
        }),
        OR: t.field({
          type: [JSONWhereInputArgument],
        }),
        NOT: t.field({
          type: JSONWhereInputArgument,
        }),
      }),
    });

  const BigIntWhereInputArgument = schemaBuilder
    .inputRef("BigIntWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.field({ type: "BigInt", required: false }),
        ne: t.field({ type: "BigInt", required: false }),
        gt: t.field({ type: "BigInt", required: false }),
        gte: t.field({ type: "BigInt", required: false }),
        lt: t.field({ type: "BigInt", required: false }),
        lte: t.field({ type: "BigInt", required: false }),
        in: t.field({ type: ["BigInt"], required: false }),
        notIn: t.field({ type: ["BigInt"], required: false }),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        AND: t.field({ type: [BigIntWhereInputArgument] }),
        OR: t.field({ type: [BigIntWhereInputArgument] }),
        NOT: t.field({ type: BigIntWhereInputArgument }),
      }),
    });

  const DateTimeWhereInputArgument = schemaBuilder
    .inputRef("DateTimeWhereInputArgument")
    .implement({
      fields: (t: any) => ({
        eq: t.field({ type: "DateTime", required: false }),
        ne: t.field({ type: "DateTime", required: false }),
        gt: t.field({ type: "DateTime", required: false }),
        gte: t.field({ type: "DateTime", required: false }),
        lt: t.field({ type: "DateTime", required: false }),
        lte: t.field({ type: "DateTime", required: false }),
        in: t.field({ type: ["DateTime"], required: false }),
        notIn: t.field({ type: ["DateTime"], required: false }),
        isNull: t.boolean(),
        isNotNull: t.boolean(),
        arrayOverlaps: t.field({ type: ["DateTime"], required: false }),
        arrayContained: t.field({ type: ["DateTime"], required: false }),
        arrayContains: t.field({ type: ["DateTime"], required: false }),
        AND: t.field({ type: [DateTimeWhereInputArgument] }),
        OR: t.field({ type: [DateTimeWhereInputArgument] }),
        NOT: t.field({ type: DateTimeWhereInputArgument }),
      }),
    });
}
