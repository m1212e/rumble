import {
  type Column,
  getTableColumns,
  getTableName,
  is,
  isTable,
  type Many,
  type One,
  type Table,
} from "drizzle-orm";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";

type RelationEntry = {
  /** TS-level key in db._.relations (i.e. the export name) */
  name: string;
  /** runtime DB table name as returned by getTableName(table) */
  dbName: string;
  /** the underlying drizzle Table object */
  table: any;
  /** columns map for the table */
  columns: Record<string, Column>;
  /** primary key columns, keyed by column ts-name */
  primaryKey: Record<string, Column>;
  /** named relations record (one/many) for this table */
  relations: Record<string, One<any, any> | Many<any>>;
  /**
   * The raw entry from db._.relations — preserved for callers that previously
   * read `foundRelation` off tableHelper().
   */
  foundRelation: any;
};

type TableIndex = {
  byTsName: Map<string, RelationEntry>;
  byDbName: Map<string, RelationEntry>;
  byTableRef: Map<any, RelationEntry>;
};

const indexCache = new WeakMap<object, TableIndex>();

function buildIndex<DB extends DrizzleInstance>(db: DB): TableIndex {
  const byTsName = new Map<string, RelationEntry>();
  const byDbName = new Map<string, RelationEntry>();
  const byTableRef = new Map<any, RelationEntry>();

  for (const [tsName, rawEntry] of Object.entries(db._.relations ?? {})) {
    const entry = rawEntry as any;
    const tableObj = entry.table;
    if (!tableObj) continue;

    const columns = (
      isTable(tableObj) ? getTableColumns(tableObj as Table) : {}
    ) as Record<string, Column>;

    const primaryKey = Object.fromEntries(
      Object.entries(columns).filter(([, col]) => (col as any).primary),
    ) as Record<string, Column>;

    const dbName = isTable(tableObj)
      ? (getTableName(tableObj as Table) as string)
      : ((entry.name as string) ?? tsName);

    const resolved: RelationEntry = {
      name: entry.name ?? tsName,
      dbName,
      table: tableObj,
      columns,
      primaryKey,
      relations: entry.relations ?? {},
      foundRelation: entry,
    };

    byTsName.set(resolved.name, resolved);
    byDbName.set(resolved.dbName, resolved);
    byTableRef.set(tableObj, resolved);
  }

  return { byTsName, byDbName, byTableRef };
}

function getIndex<DB extends DrizzleInstance>(db: DB): TableIndex {
  let idx = indexCache.get(db as unknown as object);
  if (!idx) {
    idx = buildIndex(db);
    indexCache.set(db as unknown as object, idx);
  }
  return idx;
}

export function tableHelper<
  DB extends DrizzleInstance,
  TableIdentifier extends
    | string
    | DB["_"]["relations"][keyof DB["_"]["relations"]],
>({ db, table }: { db: DB; table: TableIdentifier }) {
  const idx = getIndex(db);

  let entry: RelationEntry | undefined;

  if (typeof table === "string") {
    // Lookup by TS-level relation name first (the common case), then by DB name.
    entry = idx.byTsName.get(table) ?? idx.byDbName.get(table);
  } else if (table && typeof table === "object") {
    const t = table as any;

    // Case 1: caller passed an entry from db._.relations directly:resolve by
    // table identity via its `.table` property.
    if (t.table) {
      entry = idx.byTableRef.get(t.table);
      if (!entry && t.name) {
        entry = idx.byTsName.get(t.name) ?? idx.byDbName.get(t.name);
      }
    }

    // Case 2: caller passed a raw Table object: resolve by identity.
    if (!entry) {
      entry = idx.byTableRef.get(t);
    }

    // Case 3: last resort lookup via the public getTableName() helper.
    if (!entry && isTable(t)) {
      const dbName = getTableName(t as Table) as string;
      entry = idx.byDbName.get(dbName);
    }
  }

  if (!entry) {
    throw new RumbleError(
      `Could not find schema for ${JSON.stringify(
        typeof table === "string" ? table : "<table-object>",
      )}`,
    );
  }

  return {
    columns: entry.columns,
    primaryKey: entry.primaryKey,
    relations: entry.relations,
    dbName: entry.dbName,
    tsName: entry.name,
    table: entry.table,
    foundRelation: entry.foundRelation,
  };
}

/**
 * Looks up a relation entry by its TS-level name — i.e. the key in
 * db._.relations, which is also what `Relation.targetTableName` carries.
 * Prefer this for cross-relation navigation over re-resolving via the raw
 * `targetTable` object.
 */
export function tableHelperByTsName<DB extends DrizzleInstance>(
  db: DB,
  tsName: string,
) {
  return tableHelper({ db, table: tsName });
}

export { is };
