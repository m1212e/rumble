export function deepSetProto(
  obj: any,
  proto = Object.prototype,
  seen = new WeakSet(),
) {
  if (obj === null || typeof obj !== "object") return;
  if (seen.has(obj)) return;
  seen.add(obj);
  // Arrays must keep Array.prototype (e.g. .map/.filter) - only plain
  // objects (which graphql-js may hand back with a null prototype) need fixing up.
  if (!Array.isArray(obj)) {
    Object.setPrototypeOf(obj, proto);
  }
  for (const key of Object.keys(obj)) {
    deepSetProto(obj[key], proto, seen);
  }
}
