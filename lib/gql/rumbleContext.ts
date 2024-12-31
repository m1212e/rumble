// import type { AbilityBuilder } from "../abilities/builder";

// export function permissions<RequestEvent extends Record<string, any>>({
//     req,
//     abilityBuilder,
//   }: {
//     req: RequestEvent;
//     abilityBuilder: AbilityBuilder;
//   }) {
//   const abilities = defineAbilitiesForUser(oidc);
//   let hasBeenCalled = false;
//   return {
//     abilities,
//     /**
//      * Prisma utility for running authorized database calls. Should be used in WHERE conditions in queries like this:
//      *
//      * ```ts
//      * db.committee.deleteMany({
//      *   where: {
//      *     conferenceId: params.conferenceId,
//      *     AND: [permissions.allowDatabaseAccessTo("delete").Committee],
//      *   }
//      * })
//      * ```
//      * The default operation is "read".
//      */
//     allowDatabaseAccessTo: (action: Action = "read") => {
//       hasBeenCalled = true;
//       return accessibleBy(abilities, action);
//     },
//     /**
//      * Utility that raises and error if the permissions check fails.
//      * Allows for readable flow of permission checks which resemble natural language like this:
//      *
//      * ```ts
//      * permissions.checkIf((user) => user.can("create", "Committee"));
//      * ```
//      */
//     checkIf: (perms: boolean | ((a: typeof abilities) => boolean)) => {
//       hasBeenCalled = true;
//       if (typeof perms === "boolean") {
//         if (!perms) {
//           throw new PermissionCheckError("Permission check failed.");
//         }
//       } else {
//         if (!perms(abilities)) {
//           throw new PermissionCheckError("Permission check failed.");
//         }
//       }
//     },
//     getLoggedInUserOrThrow: () => {
//       hasBeenCalled = true;
//       if (!oidc || !oidc.user) {
//         throw new PermissionCheckError("Permission check failed.");
//       }
//       return oidc.user;
//     },
//     /**
//      * @returns True if permissions were checked. Used to emit warnings for handlers which do not check permissions.
//      */
//     werePermissionsChecked: () => hasBeenCalled,
//     /**
//      * Disable the warning that is emitted when permissions are not checked for this handler
//      */
//     disablePermissionCheckWarning: () => (hasBeenCalled = true),
//   };
// }

// export async function makeRumbleContext<
//   RequestEvent extends Record<string, any>
// >({
//   req,
//   abilityBuilder,
// }: {
//   req: RequestEvent;
//   abilityBuilder: AbilityBuilder;
// }) {
//   return { permissions: permissions(req) };
// }

// export type Context = Awaited<ReturnType<typeof makeRumbleContext>>;
