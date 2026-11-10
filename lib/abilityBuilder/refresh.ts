import { refreshAbilitiesKey } from "./keys";

/**
 * Starts a new snapshot of the abilities of every table: the `when()`
 * callbacks run again and, with `resolveRelationalRules`, the relational rules
 * are looked up again. Rumble calls this whenever a root field starts to
 * resolve. Call it yourself in a resolver that writes rows and then reads them
 * through a table whose abilities it already used before the write. A callback
 * still running is kept, so sibling root fields of one query share it.
 */
export function refreshAbilities(abilities: object | undefined) {
  if (!abilities) return;
  for (const table of Object.values(abilities)) {
    (table as any)?.[refreshAbilitiesKey]?.();
  }
}
