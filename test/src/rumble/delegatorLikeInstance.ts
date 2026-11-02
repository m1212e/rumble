import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import type { Logger } from "drizzle-orm";
import { rumble } from "../../../lib";
import type { DelegatorLikeSchema } from "../db/delegatorLike";

/**
 * The caller of a request: the signed in user and their OIDC roles.
 */
export type Caller = { userId?: string; roles: string[] };

const PARTICIPANT_CARE_ROLES = ["PROJECT_MANAGEMENT", "PARTICIPANT_CARE"];
const PAPER_ROLES = [
  "REVIEWER",
  "PROJECT_MANAGEMENT",
  "PARTICIPANT_CARE",
  "TEAM_COORDINATOR",
  "CONTENT_LEAD",
];
const TEAM_ADMIN_ROLES = ["PROJECT_MANAGEMENT", "TEAM_COORDINATOR"];

// The rule helpers of DELEGATOR's `authHelper/rules.ts`, as far as the read
// rules below use them.

const isSystemAdmin = (ctx: Caller) => ctx.roles.includes("admin");
const systemAdmin = (ctx: Caller) =>
  isSystemAdmin(ctx) ? ("allow" as const) : undefined;
const grantWhere = <W extends object>(filter: W | undefined) =>
  filter ? { where: filter } : undefined;

function isTeamMemberOf({ ctx, roles }: { ctx: Caller; roles?: string[] }) {
  if (isSystemAdmin(ctx)) return {};
  const id = ctx.userId;
  if (!id) return undefined;
  return {
    teamMembers: roles
      ? { user: { id }, role: { in: roles } }
      : { user: { id } },
  };
}

function isTeamMemberOfConference(p: { ctx: Caller; roles?: string[] }) {
  const conference = isTeamMemberOf(p);
  return conference === undefined ? undefined : { conference };
}

const withRegistration = {
  OR: [
    { delegationMember: true },
    { singleParticipant: true },
    { conferenceSupervisor: true },
  ],
};

const participatesIn = (conference: object) => ({
  conferenceParticipants: { conference, ...withRegistration },
});

function isCaredForUser(ctx: Caller) {
  if (isSystemAdmin(ctx)) return {};
  const conference = isTeamMemberOf({ ctx, roles: PARTICIPANT_CARE_ROLES });
  if (!conference) return undefined;
  return {
    OR: [participatesIn(conference), { waitingListEntry: { conference } }],
  };
}

const isOwnUser = (ctx: Caller) =>
  ctx.userId ? { user: { id: ctx.userId } } : undefined;

const isInOwnDelegation = (ctx: Caller) =>
  ctx.userId
    ? { delegation: { members: { user: { id: ctx.userId } } } }
    : undefined;

const isParticipantOf = (ctx: Caller) =>
  ctx.userId
    ? { conferenceParticipants: { userId: ctx.userId, ...withRegistration } }
    : undefined;

const publicConference = {
  state: { in: ["PARTICIPANT_REGISTRATION", "PREPARATION"] },
};

const anyOf = (filters: object[]) =>
  filters.some((f) => Object.keys(f).length === 0) ? {} : { OR: filters };

function readableConference(ctx: Caller) {
  const participant = isParticipantOf(ctx);
  const team = isTeamMemberOf({ ctx });
  return anyOf([
    publicConference,
    ...(participant ? [participant] : []),
    ...(team ? [team] : []),
  ]);
}

const maskedUntilRelease = (filter: object | undefined, columns: object) =>
  filter ? { where: filter, columns } : undefined;
const onceReleased = (filter: object | undefined) =>
  filter
    ? { where: { ...filter, conference: { assignmentReleased: true } } }
    : undefined;

const supervisedByCaller = (ctx: Caller) =>
  ctx.userId ? { supervisors: { user: { id: ctx.userId } } } : undefined;

/**
 * Registers the read rules of DELEGATOR's `*Permissions.ts` files for the
 * tables of the fixture, the `user` ones in full: about ten relational rules
 * with differing columns, which is what makes every nested `user` expensive.
 */
function registerAbilities(ab: any) {
  const NAME = {
    id: true,
    createdAt: true,
    updatedAt: true,
    givenName: true,
    familyName: true,
    pronouns: true,
  };
  const NAME_AND_EMAIL = { ...NAME, email: true };
  const IDENTITY = {
    ...NAME_AND_EMAIL,
    preferredUsername: true,
    locale: true,
    birthday: true,
  };
  const WITHOUT_CARE_NOTES = { globalNotes: false };

  const duplicateOfCaredForUser = (ctx: Caller, status: string[]) => {
    const caredFor = isCaredForUser(ctx);
    if (!caredFor) return undefined;
    const standing = { status: { in: status } };
    return {
      OR: [
        { duplicatesAsUser: { ...standing, candidate: caredFor } },
        { duplicatesAsCandidate: { ...standing, user: caredFor } },
      ],
    };
  };

  ab.user.allow("read").when(systemAdmin);
  ab.user
    .allow("read")
    .when((ctx: Caller) =>
      ctx.userId
        ? { where: { id: ctx.userId }, columns: WITHOUT_CARE_NOTES }
        : undefined,
    );
  ab.user.allow("read").when((ctx: Caller) => grantWhere(isCaredForUser(ctx)));
  ab.user.allow("read").when((ctx: Caller) => {
    const filter = duplicateOfCaredForUser(ctx, ["OPEN", "CONFIRMED"]);
    return filter
      ? { where: filter, columns: { ...IDENTITY, globalNotes: true } }
      : undefined;
  });
  ab.user.allow("read").when((ctx: Caller) => {
    const filter = duplicateOfCaredForUser(ctx, ["DISMISSED"]);
    return filter ? { where: filter, columns: IDENTITY } : undefined;
  });
  ab.user.allow("read").when((ctx: Caller) => {
    const supervised = supervisedByCaller(ctx);
    return supervised
      ? {
          where: {
            OR: [
              { delegationMemberships: supervised },
              { singleParticipant: supervised },
            ],
          },
          columns: WITHOUT_CARE_NOTES,
        }
      : undefined;
  });
  ab.user.allow("read").when((ctx: Caller) => {
    const conference = isTeamMemberOf({ ctx, roles: TEAM_ADMIN_ROLES });
    return conference
      ? { where: { teamMember: { conference } }, columns: WITHOUT_CARE_NOTES }
      : undefined;
  });
  ab.user.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            teamMember: {
              conference: { teamMembers: { user: { id: ctx.userId } } },
            },
          },
          columns: { ...IDENTITY, phone: true },
        }
      : undefined,
  );
  ab.user.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            delegationMemberships: {
              delegation: { members: { user: { id: ctx.userId } } },
            },
          },
          columns: NAME_AND_EMAIL,
        }
      : undefined,
  );
  ab.user.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            conferenceSupervisor: {
              OR: [
                { supervisedDelegationMembers: { user: { id: ctx.userId } } },
                { supervisedSingleParticipants: { user: { id: ctx.userId } } },
              ],
            },
          },
          columns: NAME_AND_EMAIL,
        }
      : undefined,
  );
  ab.user.allow("read").when((ctx: Caller) => {
    const supervised = supervisedByCaller(ctx);
    return supervised
      ? {
          where: {
            conferenceSupervisor: {
              OR: [
                { supervisedDelegationMembers: supervised },
                { supervisedSingleParticipants: supervised },
              ],
            },
          },
          columns: NAME_AND_EMAIL,
        }
      : undefined;
  });
  ab.user.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            papers: {
              conference: {
                teamMembers: {
                  user: { id: ctx.userId },
                  role: { in: PAPER_ROLES },
                },
              },
            },
          },
          columns: NAME,
        }
      : undefined,
  );
  ab.user.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            paperReviews: {
              paperVersion: {
                paper: { authorParticipant: { userId: ctx.userId } },
              },
            },
          },
          columns: { id: true, givenName: true, familyName: true },
        }
      : undefined,
  );

  // conference
  ab.conference.allow("read").when(() => ({
    where: publicConference,
    columns: { assignmentReleased: false },
  }));
  ab.conference.allow("read").when(systemAdmin);
  ab.conference
    .allow("read")
    .when((ctx: Caller) => grantWhere(isParticipantOf(ctx)));
  ab.conference
    .allow("read")
    .when((ctx: Caller) => grantWhere(isTeamMemberOf({ ctx })));

  // teamMember
  ab.teamMember.allow("read").when(systemAdmin);
  ab.teamMember
    .allow("read")
    .when((ctx: Caller) => grantWhere(isTeamMemberOfConference({ ctx })));

  // conferenceParticipant
  ab.conferenceParticipant.allow("read").when(systemAdmin);
  ab.conferenceParticipant
    .allow("read")
    .when((ctx: Caller) => grantWhere(isOwnUser(ctx)));
  ab.conferenceParticipant
    .allow("read")
    .when((ctx: Caller) => grantWhere(supervisedByCaller(ctx)));
  ab.conferenceParticipant.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            delegationMember: {
              delegation: { members: { user: { id: ctx.userId } } },
            },
          },
        }
      : undefined,
  );
  ab.conferenceParticipant
    .allow("read")
    .when((ctx: Caller) =>
      grantWhere(
        isTeamMemberOfConference({ ctx, roles: PARTICIPANT_CARE_ROLES }),
      ),
    );

  // conferenceSupervisor
  const WITHOUT_CONNECTION_CODE = { connectionCode: false };
  ab.conferenceSupervisor.allow("read").when(systemAdmin);
  ab.conferenceSupervisor
    .allow("read")
    .when((ctx: Caller) =>
      grantWhere(
        isTeamMemberOfConference({ ctx, roles: PARTICIPANT_CARE_ROLES }),
      ),
    );
  ab.conferenceSupervisor.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            OR: [
              { supervisedDelegationMembers: { user: { id: ctx.userId } } },
              { supervisedSingleParticipants: { user: { id: ctx.userId } } },
            ],
          },
          columns: WITHOUT_CONNECTION_CODE,
        }
      : undefined,
  );
  ab.conferenceSupervisor
    .allow("read")
    .when((ctx: Caller) => grantWhere(isOwnUser(ctx)));
  ab.conferenceSupervisor.allow("read").when((ctx: Caller) => {
    const supervisedByMe = supervisedByCaller(ctx);
    return supervisedByMe
      ? {
          where: {
            OR: [
              { supervisedDelegationMembers: supervisedByMe },
              { supervisedSingleParticipants: supervisedByMe },
            ],
          },
          columns: WITHOUT_CONNECTION_CODE,
        }
      : undefined;
  });

  // delegation
  const DELEGATION_ASSIGNMENT = { assignedRoleId: false };
  const ownDelegation = (ctx: Caller) =>
    ctx.userId ? { members: { user: { id: ctx.userId } } } : undefined;
  const supervisedDelegation = (ctx: Caller) =>
    ctx.userId
      ? { members: { supervisors: { user: { id: ctx.userId } } } }
      : undefined;
  ab.delegation.allow("read").when(systemAdmin);
  ab.delegation
    .allow("read")
    .when((ctx: Caller) =>
      maskedUntilRelease(ownDelegation(ctx), DELEGATION_ASSIGNMENT),
    );
  ab.delegation
    .allow("read")
    .when((ctx: Caller) => onceReleased(ownDelegation(ctx)));
  ab.delegation
    .allow("read")
    .when((ctx: Caller) =>
      maskedUntilRelease(supervisedDelegation(ctx), DELEGATION_ASSIGNMENT),
    );
  ab.delegation
    .allow("read")
    .when((ctx: Caller) => onceReleased(supervisedDelegation(ctx)));
  ab.delegation
    .allow("read")
    .when((ctx: Caller) =>
      grantWhere(
        isTeamMemberOfConference({ ctx, roles: PARTICIPANT_CARE_ROLES }),
      ),
    );
  ab.delegation.allow("read").when((ctx: Caller) => {
    const team = isTeamMemberOfConference({ ctx });
    return team ? { where: team, columns: { entryCode: false } } : undefined;
  });

  // delegationMember
  const MEMBER_ASSIGNMENT = { assignedCommitteeId: false };
  const supervisedMember = (ctx: Caller) =>
    ctx.userId
      ? {
          delegation: {
            members: { supervisors: { user: { id: ctx.userId } } },
          },
        }
      : undefined;
  ab.delegationMember.allow("read").when(systemAdmin);
  ab.delegationMember
    .allow("read")
    .when((ctx: Caller) =>
      maskedUntilRelease(isInOwnDelegation(ctx), MEMBER_ASSIGNMENT),
    );
  ab.delegationMember
    .allow("read")
    .when((ctx: Caller) => onceReleased(isInOwnDelegation(ctx)));
  ab.delegationMember
    .allow("read")
    .when((ctx: Caller) =>
      maskedUntilRelease(supervisedMember(ctx), MEMBER_ASSIGNMENT),
    );
  ab.delegationMember
    .allow("read")
    .when((ctx: Caller) => onceReleased(supervisedMember(ctx)));
  ab.delegationMember
    .allow("read")
    .when((ctx: Caller) =>
      grantWhere(
        isTeamMemberOfConference({ ctx, roles: PARTICIPANT_CARE_ROLES }),
      ),
    );

  // roleApplication
  ab.roleApplication.allow("read").when(systemAdmin);
  ab.roleApplication
    .allow("read")
    .when((ctx: Caller) => grantWhere(isInOwnDelegation(ctx)));
  ab.roleApplication.allow("read").when((ctx: Caller) => {
    const delegation = isTeamMemberOfConference({
      ctx,
      roles: PARTICIPANT_CARE_ROLES,
    });
    return delegation ? { where: { delegation } } : undefined;
  });
  ab.roleApplication.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            delegation: {
              members: { supervisors: { user: { id: ctx.userId } } },
            },
          },
        }
      : undefined,
  );

  // conferenceRole, nation
  ab.conferenceRole.allow("read").when((ctx: Caller) => ({
    where: { conference: readableConference(ctx) },
  }));
  ab.nation.allow("read");

  // paper
  ab.paper.allow("read").when(systemAdmin);
  ab.paper
    .allow("read")
    .when((ctx: Caller) =>
      ctx.userId
        ? { where: { authorParticipant: { userId: ctx.userId } } }
        : undefined,
    );
  ab.paper
    .allow("read")
    .when((ctx: Caller) =>
      grantWhere(isTeamMemberOfConference({ ctx, roles: PAPER_ROLES })),
    );
  ab.paper.allow("read").when((ctx: Caller) =>
    ctx.userId
      ? {
          where: {
            delegation: {
              members: { supervisors: { user: { id: ctx.userId } } },
            },
            status: { ne: "DRAFT" },
          },
        }
      : undefined,
  );
  ab.paper.allow("read").when((ctx: Caller) => {
    const delegation = isInOwnDelegation(ctx);
    return delegation
      ? { where: { ...delegation, status: { ne: "DRAFT" } } }
      : undefined;
  });
}

/** The warning threshold TODO.md suggests for a single generated statement. */
export const MAX_STATEMENT_LENGTH = 16_000;

/** What DELEGATOR's supervisor card reads of a delegation (TODO.md). */
export const SUPERVISOR_CARD_QUERY = /* GraphQL */ `
  query($id: ID!) {
    delegation(id: $id) {
      id applied entryCode experience motivation
      appliedForRoles { id rank role { kind fontAwesomeIcon nation { alpha2Code } } }
      assignedRole { kind name fontAwesomeIcon nation { alpha2Code alpha3Code } }
      members { id isHeadDelegate }
      papers { id author { id } }
    }
  }
`;

/** The card's second query: the members the caller supervises, with their user. */
export const SUPERVISED_MEMBERS_QUERY = /* GraphQL */ `
  query($delegationId: ID!, $supervisorId: ID!) {
    delegationMembers(
      where: {
        delegationId: { eq: $delegationId }
        supervisors: { id: { eq: $supervisorId } }
      }
    ) {
      id isHeadDelegate
      user { id givenName familyName email phone birthday globalNotes }
    }
  }
`;

export type CapturedStatement = { sql: string; params: unknown[] };

/**
 * A drizzle logger collecting every statement the database was asked to run.
 */
export function makeStatementCapture() {
  const statements: CapturedStatement[] = [];
  const logger: Logger = {
    logQuery(sql, params) {
      statements.push({ sql, params });
    },
  };
  return {
    logger,
    statements,
    reset: () => {
      statements.length = 0;
    },
  };
}

/**
 * A rumble instance over the DELEGATOR-like schema with DELEGATOR's read rules,
 * exposing every table as an object and the two queries the supervisor's card
 * runs: `delegation(id)` and `delegationMembers(where)`.
 */
export function makeDelegatorLikeInstance(
  db: any,
  schema: DelegatorLikeSchema,
  caller: Caller,
) {
  const r = rumble({
    db,
    schema,
    context: () => caller,
    defaultLimit: null,
  });

  registerAbilities(r.abilityBuilder);

  // the schema is built at runtime, so the table names are plain strings here
  const untyped = r as any;
  for (const table of Object.keys(schema)) {
    untyped.object({
      table,
      refName: table[0]!.toUpperCase() + table.slice(1),
    });
  }
  untyped.query({ table: "delegation" });
  untyped.query({ table: "delegationMember" });

  const yoga = r.createYoga({ maskedErrors: false });
  const executor = buildHTTPExecutor({
    fetch: yoga.fetch,
    endpoint: "http://yoga/graphql",
  });

  return { rumble: r, executor };
}

/**
 * The size figures of a statement, the ones TODO.md reports for the
 * production statement.
 */
export function statementMetrics(
  { sql, params }: CapturedStatement,
  tableNames: string[],
) {
  const count = (re: RegExp) => (sql.match(re) ?? []).length;
  return {
    length: sql.length,
    params: params.length,
    exists: count(/\bexists\s*\(/gi),
    caseWhen: count(/\bcase when\b/gi),
    tables: Object.fromEntries(
      tableNames.map((name) => [name, count(new RegExp(`"${name}"`, "g"))]),
    ),
  };
}
