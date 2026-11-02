import {
  defineRelations,
  getTableColumns,
  getTableName,
  sql,
} from "drizzle-orm";

/**
 * A schema shaped like MUNify DELEGATOR's, reduced to the tables its read
 * rules walk: the fixture for the statement size tests (generated SQL so
 * large that planning it took a database down).
 *
 * The tables are built through a `DialectKit`, so the same schema runs on the
 * in-memory SQLite of the test suite and, for `explain (memory)`, on Postgres.
 */
export type DialectKit = {
  table: (name: string, columns: Record<string, any>) => any;
  text: () => any;
  boolean: () => any;
  integer: () => any;
};

export function makeDelegatorLikeSchema(k: DialectKit) {
  const id = () => k.text().primaryKey();

  const user = k.table("user", {
    id: id(),
    createdAt: k.text(),
    updatedAt: k.text(),
    email: k.text().notNull(),
    familyName: k.text().notNull(),
    givenName: k.text().notNull(),
    locale: k.text().notNull(),
    preferredUsername: k.text().notNull(),
    birthday: k.text(),
    phone: k.text(),
    street: k.text(),
    city: k.text(),
    country: k.text(),
    pronouns: k.text(),
    emergencyContacts: k.text(),
    globalNotes: k.text(),
  });

  const conference = k.table("conference", {
    id: id(),
    title: k.text().notNull(),
    state: k.text().notNull(),
    assignmentReleased: k.boolean().notNull(),
  });

  const teamMember = k.table("team_member", {
    id: id(),
    userId: k.text().notNull(),
    conferenceId: k.text().notNull(),
    role: k.text().notNull(),
  });

  const conferenceParticipant = k.table("conference_participant", {
    id: id(),
    userId: k.text().notNull(),
    conferenceId: k.text().notNull(),
  });

  const conferenceSupervisor = k.table("conference_supervisor", {
    id: id(),
    conferenceParticipantId: k.text().notNull(),
    connectionCode: k.text().notNull(),
    plansOwnAttendenceAtConference: k.boolean().notNull(),
  });

  // DELEGATOR's implicit many-to-many between supervisors (a) and the
  // participants they supervise (b)
  const supervision = k.table("supervision", {
    id: id(),
    a: k.text().notNull(),
    b: k.text().notNull(),
  });

  const delegation = k.table("delegation", {
    id: id(),
    conferenceId: k.text().notNull(),
    applied: k.boolean().notNull(),
    entryCode: k.text().notNull(),
    experience: k.text(),
    motivation: k.text(),
    assignedRoleId: k.text(),
  });

  const delegationMember = k.table("delegation_member", {
    id: id(),
    delegationId: k.text().notNull(),
    conferenceParticipantId: k.text().notNull(),
    isHeadDelegate: k.boolean().notNull(),
    assignedCommitteeId: k.text(),
  });

  const singleParticipant = k.table("single_participant", {
    id: id(),
    conferenceParticipantId: k.text().notNull(),
    assignedRoleId: k.text(),
  });

  const waitingListEntry = k.table("waiting_list_entry", {
    id: id(),
    userId: k.text().notNull(),
    conferenceId: k.text().notNull(),
  });

  const possibleDuplicate = k.table("possible_duplicate", {
    id: id(),
    userId: k.text().notNull(),
    candidateId: k.text().notNull(),
    status: k.text().notNull(),
  });

  const nation = k.table("nation", {
    alpha3Code: id(),
    alpha2Code: k.text().notNull(),
  });

  const conferenceRole = k.table("conference_role", {
    id: id(),
    conferenceId: k.text().notNull(),
    kind: k.text().notNull(),
    name: k.text(),
    fontAwesomeIcon: k.text(),
    nationAlpha3Code: k.text(),
  });

  const roleApplication = k.table("role_application", {
    id: id(),
    delegationId: k.text().notNull(),
    roleId: k.text().notNull(),
    rank: k.integer().notNull(),
  });

  const paper = k.table("paper", {
    id: id(),
    delegationId: k.text().notNull(),
    authorParticipantId: k.text().notNull(),
    status: k.text().notNull(),
  });

  const paperVersion = k.table("paper_version", {
    id: id(),
    paperId: k.text().notNull(),
  });

  const paperReview = k.table("paper_review", {
    id: id(),
    paperVersionId: k.text().notNull(),
    reviewerId: k.text().notNull(),
  });

  const schema = {
    user,
    conference,
    teamMember,
    conferenceParticipant,
    conferenceSupervisor,
    supervision,
    delegation,
    delegationMember,
    singleParticipant,
    waitingListEntry,
    possibleDuplicate,
    nation,
    conferenceRole,
    roleApplication,
    paper,
    paperVersion,
    paperReview,
  };

  const relations = defineRelations(schema, (r: any) => ({
    user: {
      duplicatesAsUser: r.many.possibleDuplicate({
        from: r.user.id,
        to: r.possibleDuplicate.userId,
        alias: "possibleDuplicateUser",
      }),
      duplicatesAsCandidate: r.many.possibleDuplicate({
        from: r.user.id,
        to: r.possibleDuplicate.candidateId,
        alias: "possibleDuplicateCandidate",
      }),
      conferenceParticipants: r.many.conferenceParticipant({
        from: r.user.id,
        to: r.conferenceParticipant.userId,
      }),
      conferenceSupervisor: r.many.conferenceSupervisor({
        from: r.user.id.through(r.conferenceParticipant.userId),
        to: r.conferenceSupervisor.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
      }),
      delegationMemberships: r.many.delegationMember({
        from: r.user.id.through(r.conferenceParticipant.userId),
        to: r.delegationMember.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
      }),
      singleParticipant: r.many.singleParticipant({
        from: r.user.id.through(r.conferenceParticipant.userId),
        to: r.singleParticipant.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
      }),
      papers: r.many.paper({
        from: r.user.id.through(r.conferenceParticipant.userId),
        to: r.paper.authorParticipantId.through(r.conferenceParticipant.id),
      }),
      paperReviews: r.many.paperReview({
        from: r.user.id,
        to: r.paperReview.reviewerId,
      }),
      teamMember: r.many.teamMember({
        from: r.user.id,
        to: r.teamMember.userId,
      }),
      waitingListEntry: r.many.waitingListEntry({
        from: r.user.id,
        to: r.waitingListEntry.userId,
      }),
    },
    conference: {
      teamMembers: r.many.teamMember({
        from: r.conference.id,
        to: r.teamMember.conferenceId,
      }),
      conferenceParticipants: r.many.conferenceParticipant({
        from: r.conference.id,
        to: r.conferenceParticipant.conferenceId,
      }),
      delegations: r.many.delegation({
        from: r.conference.id,
        to: r.delegation.conferenceId,
      }),
      waitingListEntries: r.many.waitingListEntry({
        from: r.conference.id,
        to: r.waitingListEntry.conferenceId,
      }),
    },
    teamMember: {
      conference: r.one.conference({
        from: r.teamMember.conferenceId,
        to: r.conference.id,
        optional: false,
      }),
      user: r.one.user({
        from: r.teamMember.userId,
        to: r.user.id,
        optional: false,
      }),
    },
    conferenceParticipant: {
      conference: r.one.conference({
        from: r.conferenceParticipant.conferenceId,
        to: r.conference.id,
        optional: false,
      }),
      user: r.one.user({
        from: r.conferenceParticipant.userId,
        to: r.user.id,
        optional: false,
      }),
      supervisors: r.many.conferenceSupervisor({
        from: r.conferenceParticipant.id.through(r.supervision.b),
        to: r.conferenceSupervisor.id.through(r.supervision.a),
      }),
      delegationMember: r.one.delegationMember({
        from: r.conferenceParticipant.id,
        to: r.delegationMember.conferenceParticipantId,
      }),
      singleParticipant: r.one.singleParticipant({
        from: r.conferenceParticipant.id,
        to: r.singleParticipant.conferenceParticipantId,
      }),
      conferenceSupervisor: r.one.conferenceSupervisor({
        from: r.conferenceParticipant.id,
        to: r.conferenceSupervisor.conferenceParticipantId,
      }),
    },
    conferenceSupervisor: {
      conference: r.one.conference({
        from: r.conferenceSupervisor.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
        to: r.conference.id.through(r.conferenceParticipant.conferenceId),
        optional: false,
      }),
      supervisedDelegationMembers: r.many.delegationMember({
        from: r.conferenceSupervisor.id.through(r.supervision.a),
        to: r.delegationMember.conferenceParticipantId.through(r.supervision.b),
      }),
      supervisedSingleParticipants: r.many.singleParticipant({
        from: r.conferenceSupervisor.id.through(r.supervision.a),
        to: r.singleParticipant.conferenceParticipantId.through(
          r.supervision.b,
        ),
      }),
      participant: r.one.conferenceParticipant({
        from: r.conferenceSupervisor.conferenceParticipantId,
        to: r.conferenceParticipant.id,
        optional: false,
      }),
      user: r.one.user({
        from: r.conferenceSupervisor.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
        to: r.user.id.through(r.conferenceParticipant.userId),
        optional: false,
      }),
    },
    delegation: {
      appliedForRoles: r.many.roleApplication({
        from: r.delegation.id,
        to: r.roleApplication.delegationId,
      }),
      assignedRole: r.one.conferenceRole({
        from: r.delegation.assignedRoleId,
        to: r.conferenceRole.id,
      }),
      conference: r.one.conference({
        from: r.delegation.conferenceId,
        to: r.conference.id,
        optional: false,
      }),
      members: r.many.delegationMember({
        from: r.delegation.id,
        to: r.delegationMember.delegationId,
      }),
      papers: r.many.paper({
        from: r.delegation.id,
        to: r.paper.delegationId,
      }),
    },
    delegationMember: {
      conference: r.one.conference({
        from: r.delegationMember.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
        to: r.conference.id.through(r.conferenceParticipant.conferenceId),
        optional: false,
      }),
      delegation: r.one.delegation({
        from: r.delegationMember.delegationId,
        to: r.delegation.id,
        optional: false,
      }),
      participant: r.one.conferenceParticipant({
        from: r.delegationMember.conferenceParticipantId,
        to: r.conferenceParticipant.id,
        optional: false,
      }),
      supervisors: r.many.conferenceSupervisor({
        from: r.delegationMember.conferenceParticipantId.through(
          r.supervision.b,
        ),
        to: r.conferenceSupervisor.id.through(r.supervision.a),
      }),
      user: r.one.user({
        from: r.delegationMember.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
        to: r.user.id.through(r.conferenceParticipant.userId),
        optional: false,
      }),
    },
    singleParticipant: {
      conference: r.one.conference({
        from: r.singleParticipant.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
        to: r.conference.id.through(r.conferenceParticipant.conferenceId),
        optional: false,
      }),
      participant: r.one.conferenceParticipant({
        from: r.singleParticipant.conferenceParticipantId,
        to: r.conferenceParticipant.id,
        optional: false,
      }),
      supervisors: r.many.conferenceSupervisor({
        from: r.singleParticipant.conferenceParticipantId.through(
          r.supervision.b,
        ),
        to: r.conferenceSupervisor.id.through(r.supervision.a),
      }),
      user: r.one.user({
        from: r.singleParticipant.conferenceParticipantId.through(
          r.conferenceParticipant.id,
        ),
        to: r.user.id.through(r.conferenceParticipant.userId),
        optional: false,
      }),
    },
    waitingListEntry: {
      conference: r.one.conference({
        from: r.waitingListEntry.conferenceId,
        to: r.conference.id,
        optional: false,
      }),
      user: r.one.user({
        from: r.waitingListEntry.userId,
        to: r.user.id,
        optional: false,
      }),
    },
    possibleDuplicate: {
      user: r.one.user({
        from: r.possibleDuplicate.userId,
        to: r.user.id,
        optional: false,
        alias: "possibleDuplicateUser",
      }),
      candidate: r.one.user({
        from: r.possibleDuplicate.candidateId,
        to: r.user.id,
        optional: false,
        alias: "possibleDuplicateCandidate",
      }),
    },
    nation: {
      conferenceRoles: r.many.conferenceRole({
        from: r.nation.alpha3Code,
        to: r.conferenceRole.nationAlpha3Code,
      }),
    },
    conferenceRole: {
      conference: r.one.conference({
        from: r.conferenceRole.conferenceId,
        to: r.conference.id,
        optional: false,
      }),
      nation: r.one.nation({
        from: r.conferenceRole.nationAlpha3Code,
        to: r.nation.alpha3Code,
      }),
      assignedDelegations: r.many.delegation({
        from: r.conferenceRole.id,
        to: r.delegation.assignedRoleId,
      }),
    },
    roleApplication: {
      delegation: r.one.delegation({
        from: r.roleApplication.delegationId,
        to: r.delegation.id,
        optional: false,
      }),
      role: r.one.conferenceRole({
        from: r.roleApplication.roleId,
        to: r.conferenceRole.id,
        optional: false,
      }),
    },
    paper: {
      authorParticipant: r.one.conferenceParticipant({
        from: r.paper.authorParticipantId,
        to: r.conferenceParticipant.id,
        optional: false,
      }),
      author: r.one.user({
        from: r.paper.authorParticipantId.through(r.conferenceParticipant.id),
        to: r.user.id.through(r.conferenceParticipant.userId),
        optional: false,
      }),
      conference: r.one.conference({
        from: r.paper.delegationId.through(r.delegation.id),
        to: r.conference.id.through(r.delegation.conferenceId),
        optional: false,
      }),
      delegation: r.one.delegation({
        from: r.paper.delegationId,
        to: r.delegation.id,
        optional: false,
      }),
      versions: r.many.paperVersion({
        from: r.paper.id,
        to: r.paperVersion.paperId,
      }),
    },
    paperVersion: {
      paper: r.one.paper({
        from: r.paperVersion.paperId,
        to: r.paper.id,
        optional: false,
      }),
      reviews: r.many.paperReview({
        from: r.paperVersion.id,
        to: r.paperReview.paperVersionId,
      }),
    },
    paperReview: {
      paperVersion: r.one.paperVersion({
        from: r.paperReview.paperVersionId,
        to: r.paperVersion.id,
        optional: false,
      }),
      reviewer: r.one.user({
        from: r.paperReview.reviewerId,
        to: r.user.id,
        optional: false,
      }),
    },
  }));

  return { schema, relations };
}

export type DelegatorLikeSchema = ReturnType<
  typeof makeDelegatorLikeSchema
>["schema"];

/**
 * Creates the tables of the schema from their column definitions, without
 * foreign keys or indexes: the tests look at the statements rumble generates,
 * not at how the database executes them. `qualify` turns a table name into the
 * name to create it under (e.g. inside a Postgres schema).
 */
export async function createTables(
  db: { execute?: (q: any) => Promise<unknown>; run?: (q: any) => unknown },
  schema: Record<string, any>,
  qualify: (name: string) => string = (name) => `"${name}"`,
) {
  for (const table of Object.values(schema)) {
    const columns = Object.values(getTableColumns(table)).map((column: any) => {
      const parts = [`"${column.name}"`, column.getSQLType()];
      if (column.primary) parts.push("primary key");
      else if (column.notNull) parts.push("not null");
      return parts.join(" ");
    });
    const statement = sql.raw(
      `create table ${qualify(getTableName(table))} (${columns.join(", ")})`,
    );
    if (db.execute) await db.execute(statement);
    else db.run!(statement);
  }
}

/**
 * The rows of one supervised delegation, as the supervisor's dashboard card
 * reads them: a conference with a team, a delegation of two delegates both
 * supervised by the caller, a paper by one of them and two role applications.
 */
export async function seedSupervisedDelegation(
  db: any,
  schema: DelegatorLikeSchema,
) {
  const ids = {
    conference: "conf-1",
    supervisor: "user-supervisor",
    headDelegate: "user-head",
    delegate: "user-delegate",
    teamMember: "user-team",
    delegation: "delegation-1",
    supervisorParticipant: "cp-supervisor",
    headParticipant: "cp-head",
    delegateParticipant: "cp-delegate",
    conferenceSupervisor: "cs-1",
    headMember: "dm-head",
    delegateMember: "dm-delegate",
    paper: "paper-1",
  };

  const person = (id: string, name: string) => ({
    id,
    email: `${id}@example.org`,
    givenName: name,
    familyName: "Example",
    locale: "de",
    preferredUsername: id,
    phone: "+49 30 1234567",
    birthday: "2008-01-01",
    globalNotes: `notes about ${id}`,
  });

  await db
    .insert(schema.user)
    .values([
      person(ids.supervisor, "Sam"),
      person(ids.headDelegate, "Hana"),
      person(ids.delegate, "Dana"),
      person(ids.teamMember, "Tim"),
    ]);
  await db.insert(schema.conference).values({
    id: ids.conference,
    title: "MUN 2026",
    state: "PARTICIPANT_REGISTRATION",
    assignmentReleased: false,
  });
  await db.insert(schema.teamMember).values({
    id: "tm-1",
    userId: ids.teamMember,
    conferenceId: ids.conference,
    role: "PARTICIPANT_CARE",
  });
  await db.insert(schema.conferenceParticipant).values([
    {
      id: ids.supervisorParticipant,
      userId: ids.supervisor,
      conferenceId: ids.conference,
    },
    {
      id: ids.headParticipant,
      userId: ids.headDelegate,
      conferenceId: ids.conference,
    },
    {
      id: ids.delegateParticipant,
      userId: ids.delegate,
      conferenceId: ids.conference,
    },
  ]);
  await db.insert(schema.conferenceSupervisor).values({
    id: ids.conferenceSupervisor,
    conferenceParticipantId: ids.supervisorParticipant,
    connectionCode: "SECRET",
    plansOwnAttendenceAtConference: true,
  });
  // the caller supervises both delegates, like a teacher their school's delegation
  await db.insert(schema.supervision).values([
    { id: "sv-head", a: ids.conferenceSupervisor, b: ids.headParticipant },
    {
      id: "sv-delegate",
      a: ids.conferenceSupervisor,
      b: ids.delegateParticipant,
    },
  ]);
  await db.insert(schema.nation).values([
    { alpha3Code: "DEU", alpha2Code: "DE" },
    { alpha3Code: "FRA", alpha2Code: "FR" },
  ]);
  await db.insert(schema.conferenceRole).values([
    {
      id: "role-deu",
      conferenceId: ids.conference,
      kind: "NATION",
      nationAlpha3Code: "DEU",
    },
    {
      id: "role-fra",
      conferenceId: ids.conference,
      kind: "NATION",
      nationAlpha3Code: "FRA",
    },
  ]);
  await db.insert(schema.delegation).values({
    id: ids.delegation,
    conferenceId: ids.conference,
    applied: true,
    entryCode: "JOIN-ME",
    experience: "some",
    motivation: "lots",
    assignedRoleId: "role-deu",
  });
  await db.insert(schema.delegationMember).values([
    {
      id: ids.headMember,
      delegationId: ids.delegation,
      conferenceParticipantId: ids.headParticipant,
      isHeadDelegate: true,
    },
    {
      id: ids.delegateMember,
      delegationId: ids.delegation,
      conferenceParticipantId: ids.delegateParticipant,
      isHeadDelegate: false,
    },
  ]);
  await db.insert(schema.roleApplication).values([
    { id: "ra-1", delegationId: ids.delegation, roleId: "role-deu", rank: 1 },
    { id: "ra-2", delegationId: ids.delegation, roleId: "role-fra", rank: 2 },
  ]);
  await db.insert(schema.paper).values({
    id: ids.paper,
    delegationId: ids.delegation,
    authorParticipantId: ids.delegateParticipant,
    status: "SUBMITTED",
  });

  return ids;
}
