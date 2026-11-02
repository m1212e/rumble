import { beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as t from "drizzle-orm/sqlite-core";
import { parse } from "graphql";
import {
  createTables,
  makeDelegatorLikeSchema,
  seedSupervisedDelegation,
} from "./db/delegatorLike";
import {
  type Caller,
  MAX_STATEMENT_LENGTH,
  makeDelegatorLikeInstance,
  makeStatementCapture,
  SUPERVISED_MEMBERS_QUERY,
  SUPERVISOR_CARD_QUERY,
  statementMetrics,
} from "./rumble/delegatorLikeInstance";

/**
 * Replicates "Generated SQL is so large that planning it can take a database
 * down": the supervisor's dashboard card of
 * MUNify DELEGATOR reads one delegation with a handful of relations, and rumble
 * turns that into a ~46 KB statement with hundreds of `exists` subqueries,
 * because every nesting site of a table with relational, column-masking rules
 * renders the full set of rules twice (row filter plus one `case when` flag
 * per column group), each walking three to five tables.
 *
 * `resolveRelationalRules` is the fix: the rules are looked up once per
 * request and the statement gets `id in (...)` instead. These tests pin the
 * "done when" of the report with it enabled, and that the data stays the same.
 * `statementSize.postgres.test.ts` adds the planning memory on a real
 * Postgres.
 */

const COUNTED_TABLES = [
  "user",
  "conference_participant",
  "conference",
  "delegation_member",
  "team_member",
  "conference_supervisor",
  "supervision",
  "delegation",
];

describe("statement size of nested selections with relational rules", () => {
  const { schema, relations } = makeDelegatorLikeSchema({
    table: t.sqliteTable,
    text: t.text,
    boolean: () => t.integer({ mode: "boolean" }),
    integer: t.integer,
  });
  const capture = makeStatementCapture();
  const db = drizzle(":memory:", { relations, logger: capture.logger });

  type Instance = ReturnType<typeof makeDelegatorLikeInstance>;
  let ids: Awaited<ReturnType<typeof seedSupervisedDelegation>>;
  let caller: Caller;
  /** rules as registered: relational at every nesting site */
  let relational: Instance;
  /** the same rules, resolved to primary key lists per request */
  let resolved: Instance;

  beforeAll(async () => {
    await createTables(db, schema);
    ids = await seedSupervisedDelegation(db, schema);
    caller = { userId: ids.supervisor, roles: [] };
    relational = makeDelegatorLikeInstance(db, schema, caller);
    resolved = makeDelegatorLikeInstance(db, schema, caller, {
      resolveRelationalRules: { enabled: true },
    });
  });

  /**
   * Runs the query and returns its data with the metrics of the statement
   * answering it (the last one) and of the lookups before it.
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
    const statements = capture.statements.map((s) =>
      statementMetrics(s, COUNTED_TABLES),
    );
    return {
      data: result.data,
      main: statements.at(-1)!,
      lookups: statements.slice(0, -1),
    };
  };

  const card = (instance: Instance) =>
    run(instance, SUPERVISOR_CARD_QUERY, { id: ids.delegation });
  const members = (instance: Instance) =>
    run(instance, SUPERVISED_MEMBERS_QUERY, {
      delegationId: ids.delegation,
      supervisorId: ids.conferenceSupervisor,
    });

  test("the supervisor's delegation card reads what the rules grant", async () => {
    const { data } = await card(relational);
    const delegation = data.delegation;
    expect(delegation.id).toEqual(ids.delegation);
    // supervisors hand out the join code
    expect(delegation.entryCode).toEqual("JOIN-ME");
    // the assignment is masked until the conference releases it
    expect(delegation.assignedRole).toBeNull();
    expect(delegation.appliedForRoles.map((r: any) => r.rank)).toEqual([1, 2]);
    expect(delegation.members).toHaveLength(2);
    expect(delegation.papers).toEqual([
      { id: ids.paper, author: { id: ids.delegate } },
    ]);
  });

  test("the supervised members list reads what the rules grant", async () => {
    const { data } = await members(relational);
    expect(data.delegationMembers).toHaveLength(2);
    for (const member of data.delegationMembers) {
      expect(member.user.givenName).toBeString();
      expect(member.user.email).toBeString();
      // the care team's notes are not the supervisor's to read
      expect(member.user.globalNotes).toBeNull();
    }
  });

  /** Lists come back in no particular order, so they are compared sorted by id. */
  const sorted = (value: any): any => {
    if (Array.isArray(value)) {
      return value
        .map(sorted)
        .sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, sorted(v)]),
      );
    }
    return value;
  };

  test("resolved rules return the same data", async () => {
    expect(sorted((await card(resolved)).data)).toEqual(
      sorted((await card(relational)).data),
    );
    expect(sorted((await members(resolved)).data)).toEqual(
      sorted((await members(relational)).data),
    );
  });

  test("relational rules render at every nesting site, resolved ones once per table", async () => {
    const before = await card(relational);
    const after = await card(resolved);
    // measured: ~46,000 characters and ~300 `exists` before, ~5,000 and none after
    expect(before.main.exists).toBeGreaterThan(100);
    expect(after.main.length).toBeLessThan(before.main.length / 5);
    // one lookup per table with relational rules, each holding its rules once
    expect(after.lookups.length).toBeLessThanOrEqual(6);
    for (const lookup of after.lookups) {
      expect(lookup.exists).toBeLessThanOrEqual(before.main.exists / 2);
    }
  });

  test("the supervisor's delegation card is one statement in the low kilobytes", async () => {
    const { main } = await card(resolved);
    expect(main).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
  });

  test("the supervised members list is one statement in the low kilobytes", async () => {
    const { main } = await members(resolved);
    expect(main).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
  });

  test("a nested user adds a bounded amount, whatever the rules", async () => {
    // the same delegation with zero, one and two nesting sites of `user`
    const selections = [
      "members { id } papers { id }",
      "members { id user { id } } papers { id }",
      "members { id user { id } } papers { id author { id } }",
    ];
    const sizes = [];
    for (const selection of selections) {
      const { main } = await run(
        resolved,
        `query($id: ID!) { delegation(id: $id) { id ${selection} } }`,
        { id: ids.delegation },
      );
      sizes.push(main);
    }

    for (let site = 1; site < sizes.length; site++) {
      const added = {
        site,
        length: sizes[site]!.length - sizes[site - 1]!.length,
        exists: sizes[site]!.exists - sizes[site - 1]!.exists,
      };
      // with relational rules each site added ~30,000 characters and ~200
      // `exists`: every rule in the filter and once more in the flags.
      // Resolved, a site is the nested select, the id lists and the flags
      // checking them: ~1,400 characters.
      expect(added).toSatisfy((a) => a.length <= 4_000);
      expect(added).toSatisfy((a) => a.exists === 0);
    }
  });
});
