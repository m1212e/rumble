import { refreshAbilitiesKey } from "./keys";

/**
 * Starts a new snapshot of the resolved relational rules of every table, see
 * `resolveRelationalRules`. Rumble calls this whenever a root field starts to
 * resolve. Call it yourself in a resolver that writes rows and then reads them
 * through a table whose rules it already resolved before the write. A no-op
 * unless rules are resolved.
 */
export function refreshAbilities(abilities: object | undefined) {
  if (!abilities) return;
  for (const table of Object.values(abilities)) {
    (table as any)?.[refreshAbilitiesKey]?.();
  }
}
