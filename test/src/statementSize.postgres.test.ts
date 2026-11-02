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
 * `statementSize.test.ts`): what planning the
 * supervisor card's statement costs. Postgres has no limit on planning memory,
 * and ten connections planning ~100 MB each is what took DELEGATOR's database
 * down.
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

  type Instance = ReturnType<typeof makeDelegatorLikeInstance>;
  let ids: Awaited<ReturnType<typeof seedSupervisedDelegation>>;
  let relational: Instance;
  let resolved: Instance;

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
    const caller = { userId: ids.supervisor, roles: [] };
    relational = makeDelegatorLikeInstance(db, schema, caller);
    resolved = makeDelegatorLikeInstance(db, schema, caller, {
      resolveRelationalRules: { enabled: true },
    });
  });

  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists "${SCHEMA_NAME}" cascade`));
    await pool.end();
  });

  /** The planner's figures for the statement, in kB and ms. */
  const plan = async ({ sql, params }: CapturedStatement) => {
    const explained = await pool.query(
      `explain (memory, summary, format json) ${sql}`,
      params as unknown[],
    );
    const plan = explained.rows[0]["QUERY PLAN"][0];
    return {
      memoryUsedKB: plan.Planning["Memory Used"] as number,
      planningTimeMs: plan["Planning Time"] as number,
    };
  };

  /**
   * Runs the query and returns the size and planning figures of the statement
   * answering it (the last one) and the planning memory of all statements.
   */
  const run = async (
    instance: Instance,
    query: string,
    variables: Record<string, unknown>,
  ) => {
    capture.reset();
    const result: any = await instance.executor({
      document: parse(query),
      variables,
    });
    expect(result.errors).toBeUndefined();
    const statements = capture.statements;
    const planned = await Promise.all(statements.map(plan));
    const main = statements.at(-1)!;
    return {
      data: result.data,
      main: {
        ...statementMetrics(main, ["user"]),
        ...planned.at(-1)!,
        arrayLists: (main.sql.match(/= any\(\$\d+\)/g) ?? []).length,
      },
      totalMemoryUsedKB: planned.reduce((sum, p) => sum + p.memoryUsedKB, 0),
      statements: statements.length,
    };
  };

  const card = (instance: Instance) =>
    run(instance, SUPERVISOR_CARD_QUERY, { id: ids.delegation });
  const members = (instance: Instance) =>
    run(instance, SUPERVISED_MEMBERS_QUERY, {
      delegationId: ids.delegation,
      supervisorId: ids.conferenceSupervisor,
    });

  test("planning the supervisor's delegation card takes a few MB", async () => {
    const before = await card(relational);
    const after = await card(resolved);
    // measured: ~58,000 characters and 51 MB before
    expect(before.main.memoryUsedKB).toBeGreaterThan(MAX_PLANNING_MEMORY_KB);
    expect(after.main).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
    expect(after.main).toSatisfy(
      (m) => m.memoryUsedKB <= MAX_PLANNING_MEMORY_KB,
    );
    // the lookups before it are each one copy of a table's rules
    expect(after).toSatisfy(
      (a) => a.totalMemoryUsedKB < before.totalMemoryUsedKB / 2,
    );
    // the id lists are array parameters, so they do not grow the statement
    expect(after.main.arrayLists).toBeGreaterThan(0);
    expect(after.main.params).toBeLessThan(before.main.params);
    expect(after.data.delegation.members).toHaveLength(2);
    expect(after.data.delegation.papers).toHaveLength(1);
  });

  test("planning the supervised members list takes a few MB", async () => {
    const before = await members(relational);
    const after = await members(resolved);
    expect(after.main).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
    expect(after.main).toSatisfy(
      (m) => m.memoryUsedKB <= MAX_PLANNING_MEMORY_KB,
    );
    expect(after).toSatisfy(
      (a) => a.totalMemoryUsedKB < before.totalMemoryUsedKB / 2,
    );
  });
});
