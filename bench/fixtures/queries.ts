/** The GraphQL documents the request benches send, one per query shape. */
export const queries = {
  list10: /* GraphQL */ `{ users(limit: 10) { id firstName lastName email } }`,
  list100: /* GraphQL */ `{ users(limit: 100) { id firstName lastName email } }`,
  list500: /* GraphQL */ `{ users(limit: 500) { id firstName lastName email } }`,
  /** 20 users, 80 posts, 240 comments */
  nested: /* GraphQL */ `{
    users(limit: 20) {
      id
      firstName
      posts { id title comments { id text } }
    }
  }`,
  /** each comment resolves its author and post, the many to one direction */
  nestedBackwards: /* GraphQL */ `{
    comments(limit: 100) { id author { id firstName } post { id title } }
  }`,
  byId: /* GraphQL */ `query ($id: ID!) { user(id: $id) { id firstName email } }`,
  where: /* GraphQL */ `{
    users(where: { firstName: { like: "First1%" }, lastName: { isNotNull: true } }, limit: 100) {
      id firstName
    }
  }`,
  whereRelation: /* GraphQL */ `{
    posts(where: { author: { firstName: { like: "First1%" } } }, limit: 100) { id title }
  }`,
  orderBy: /* GraphQL */ `{ users(orderBy: { email: desc }, limit: 100) { id email } }`,
  count: /* GraphQL */ `{ usersCount commentsCount(where: { someNumber: { gt: 50 } }) }`,
  /**
   * sorting by a masked column has to treat it as empty on the rows which do
   * not expose it, so the input guard rewrites the orderBy (a where would be
   * rewritten too, but would match fewer rows and skew the comparison)
   */
  guardedOrderBy: /* GraphQL */ `{
    users(orderBy: { email: asc }, limit: 100) { id firstName }
  }`,
};

/** Fails the run when a bench would only measure an error response. */
export function assertOk(result: { errors?: unknown[] }, label: string) {
  if (result.errors?.length) {
    throw new Error(
      `bench query "${label}" failed: ${JSON.stringify(result.errors)}`,
    );
  }
}
