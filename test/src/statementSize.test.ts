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
 * down" (TODO.md): the supervisor's dashboard card of MUNify DELEGATOR reads
 * one delegation with a handful of relations, and rumble turns that into a
 * ~46 KB statement with hundreds of `exists` subqueries, because every nesting
 * site of a table with relational, column-masking rules renders the full set of
 * rules twice (row filter plus one `case when` flag per column group), each
 * walking three to five tables.
 *
 * The thresholds are the "done when" of the report: the card's SQL stays in
 * the low kilobytes, and the statement grows with the number of selected
 * relations, not with rules × flags × nesting depth. They fail until the
 * builder is changed; `statementSize.postgres.test.ts` adds the planning
 * memory figure on a real Postgres.
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

  let ids: Awaited<ReturnType<typeof seedSupervisedDelegation>>;
  let caller: Caller;
  let instance: ReturnType<typeof makeDelegatorLikeInstance>;

  beforeAll(async () => {
    await createTables(db, schema);
    ids = await seedSupervisedDelegation(db, schema);
    caller = { userId: ids.supervisor, roles: [] };
    instance = makeDelegatorLikeInstance(db, schema, caller);
  });

  /** Runs the query and returns its result with the statements it ran. */
  const run = async (query: string, variables: Record<string, unknown>) => {
    capture.reset();
    const result: any = await instance.executor({
      document: parse(query),
      variables,
    });
    expect(result.errors).toBeUndefined();
    expect(capture.statements).toHaveLength(1);
    return {
      data: result.data,
      metrics: statementMetrics(capture.statements[0]!, COUNTED_TABLES),
    };
  };

  test("the supervisor's delegation card reads what the rules grant", async () => {
    const { data } = await run(SUPERVISOR_CARD_QUERY, { id: ids.delegation });
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

  test("the supervisor's delegation card is one statement in the low kilobytes", async () => {
    const { metrics } = await run(SUPERVISOR_CARD_QUERY, {
      id: ids.delegation,
    });
    // measured before any change: ~47,000 characters, ~310 `exists`, 176 params
    expect(metrics).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
  });

  test("the supervised members list is one statement in the low kilobytes", async () => {
    const { data, metrics } = await run(SUPERVISED_MEMBERS_QUERY, {
      delegationId: ids.delegation,
      supervisorId: ids.conferenceSupervisor,
    });
    const members = data.delegationMembers;
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(member.user.givenName).toBeString();
      expect(member.user.email).toBeString();
      // the care team's notes are not the supervisor's to read
      expect(member.user.globalNotes).toBeNull();
    }
    // measured before any change: ~36,500 characters, ~250 `exists`
    expect(metrics).toSatisfy((m) => m.length <= MAX_STATEMENT_LENGTH);
  });

  test("a nested user costs about one evaluation of the user rules", async () => {
    // one copy of the caller's user rules: the OR of every rule's where, which
    // is what a nesting site needs at least to filter its rows
    const abilities: any = instance.rumble.abilityBuilder._.build()(caller);
    const where = (await abilities.user.filter("read")).sql.where;
    const rendered = db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(where)
      .toSQL();
    const reference = statementMetrics(rendered, COUNTED_TABLES);
    expect(reference.exists).toBeGreaterThan(0);

    // the same delegation with zero, one and two nesting sites of `user`
    const selections = [
      "members { id } papers { id }",
      "members { id user { id } } papers { id }",
      "members { id user { id } } papers { id author { id } }",
    ];
    const sizes = [];
    for (const selection of selections) {
      const { metrics } = await run(
        `query($id: ID!) { delegation(id: $id) { id ${selection} } }`,
        { id: ids.delegation },
      );
      sizes.push(metrics);
    }

    for (let site = 1; site < sizes.length; site++) {
      const added = {
        site,
        length: sizes[site]!.length - sizes[site - 1]!.length,
        exists: sizes[site]!.exists - sizes[site - 1]!.exists,
        reference: { length: reference.length, exists: reference.exists },
      };
      // measured before any change: each site adds ~30,000 characters and
      // ~205 `exists`, about twice the reference, since the column flags
      // render every rule a second time
      expect(added).toSatisfy((a) => a.length <= a.reference.length * 1.25);
      expect(added).toSatisfy((a) => a.exists <= a.reference.exists * 1.1);
    }
  });
});
