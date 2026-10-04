import SchemaBuilder, {
  type PluginConstructorMap,
  type SchemaTypes,
} from "@pothos/core";

const registered = new Set<string>();

export function registerPluginOnce<
  Name extends keyof PluginConstructorMap<SchemaTypes>,
>(name: Name, plugin: PluginConstructorMap<SchemaTypes>[Name]) {
  if (registered.has(name)) return;
  // Dev server restarts can re-evaluate this module (e.g. duplicate ESM/CJS
  // loads of @pothos/core), resetting the registered guard above and
  // causing pothos to throw on the second registerPlugin call. Reregistering
  // the same class is harmless, so allow it instead of crashing.
  SchemaBuilder.allowPluginReRegistration = true;
  SchemaBuilder.registerPlugin(name, plugin);
  registered.add(name);
}
