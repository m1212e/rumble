import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as pg from "drizzle-orm/pg-core";
import { parse } from "graphql";
import { Pool } from "pg";
import {
  createTables,
  makeDelegatorLikeSchema,
  seedSupervisedDelegation,
} from "./db/delegatorLike";
import {
  type CapturedStatement,
  MAX_STATEMENT_LENGTH,
  makeDelegatorLikeInstance,
  makeStatementCapture,
  SUPERVISED_MEMBERS_QUERY,
  SUPERVISOR_CARD_QUERY,
  statementMetrics,
} from "./rumble/delegatorLikeInstance";

/**
 * The Postgres half of the statement size replication (see
 * `statementSize.test.ts` and TODO.md): what planning the supervisor card's
 * statement costs. Postgres has no limit on planning memory, and ten
 * connections planning ~100 MB each is what took DELEGATOR's database down.
 *
 * Needs Postgres 17 or newer for `explain (memory)`. Runs only with
 * `RUMBLE_TEST_DATABASE_URL` set, e.g. against the dev compose database:
 *
 *   RUMBLE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bun test statementSize
 *
 * Everything is created in, and dropped with, its own schema.
 */

const DATABASE_URL = process.env.RUMBLE_TEST_DATABASE_URL;
const SCHEMA_NAME = "rumble_test_statement_size";

/** "a few MB, not ~100 MB" */
const MAX_PLANNING_MEMORY_KB = 16 * 1024;

describe.skipIf(!DATABASE_URL)("statement planning memory on Postgres", () => {
  const pgSchema = pg.pgSchema(SCHEMA_NAME);
  const { schema, relations } = makeDelegatorLikeSchema({
    table: pgSchema.table,
    text: pg.text,
    boolean: pg.boolean,
    integer: pg.integer,
  });
  const pool = new Pool({ connectionString: DATABASE_URL });
  const capture = makeStatementCapture();
  const db = drizzle({ client: pool, relations, logger: capture.logger });

  let ids: Awaited<ReturnType<typeof seedSupervisedDelegation>>;
  let instance: ReturnType<typeof makeDelegatorLikeInstance>;

  beforeAll(async () => {
    const version = await pool.query("show server_version_num");
    if (Number(version.rows[0].server_version_num) < 170000) {
      throw new Error(
        "explain (memory) needs Postgres 17 or newer, point RUMBLE_TEST_DATABASE_URL at one",
      );
    }
    await db.execute(sql.raw(`drop schema if exists "${SCHEMA_NAME}" cascade`));
    await db.execute(sql.raw(`create schema "${SCHEMA_NAME}"`));
    await createTables(db, schema, (name) => `"${SCHEMA_NAME}"."${name}"`);
    ids = await seedSupervisedDelegation(db, schema);
    // without statistics the planner's first attempt at the card statement
    // ran for 15 seconds on these handful of rows
    await db.execute(sql.raw(`analyze`));
    instance = makeDelegatorLikeInstance(db, schema, {
      userId: ids.supervisor,
      roles: [],
    });
  });

  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists "${SCHEMA_NAME}" cascade`));
    await pool.end();
  });

  /** Runs the query and returns the statement it ran. */
  const run = async (query: string, variables: Record<string, unknown>) => {
    capture.reset();
    const result: any = await instance.executor({
      document: parse(query),
      variables,
    });
    expect(result.errors).toBeUndefined();
    expect(capture.statements).toHaveLength(1);
    return capture.statements[0]!;
  };

  /** The planner's figures for the statement, in kB and ms. */
  const plan = async ({ sql, params }: CapturedStatement) => {
    const explained = await pool.query(
      `explain (memory, summary, format json) ${sql}`,
      params as unknown[],
    );
    const plan = explained.rows[0]["QUERY PLAN"][0];
    return {
      memoryUsedKB: plan.Planning["Memory Used"] as number,
      memoryAllocatedKB: plan.Planning["Memory Allocated"] as number,
      planningTimeMs: plan["Planning Time"] as number,
    };
  };

  test("planning the supervisor's delegation card takes a few MB", async () => {
    const statement = await run(SUPERVISOR_CARD_QUERY, { id: ids.delegation });
    const planning = await plan(statement);
    const metrics = { ...statementMetrics(statement, ["user"]), ...planning };
    // measured before any change: ~58,000 characters, 53 MB used, 57 MB allocated
    expect(metrics).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
    expect(metrics).toSatisfy((m) => m.memoryUsedKB <= MAX_PLANNING_MEMORY_KB);
  });

  test("planning the supervised members list takes a few MB", async () => {
    const statement = await run(SUPERVISED_MEMBERS_QUERY, {
      delegationId: ids.delegation,
      supervisorId: ids.conferenceSupervisor,
    });
    const planning = await plan(statement);
    const metrics = { ...statementMetrics(statement, ["user"]), ...planning };
    expect(metrics).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
    expect(metrics).toSatisfy((m) => m.memoryUsedKB <= MAX_PLANNING_MEMORY_KB);
  });
});
