export function deepSetProto(
  obj: any,
  proto = Object.prototype,
  seen = new WeakSet(),
) {
  if (obj === null || typeof obj !== "object") return;
  if (seen.has(obj)) return;
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepSetProto(item, proto, seen);
    }
    return;
  }

  const currentProto = Object.getPrototypeOf(obj);
  if (currentProto !== Object.prototype && currentProto !== null) {
    return;
  }
  Object.setPrototypeOf(obj, proto);
  for (const key of Object.keys(obj)) {
    deepSetProto(obj[key], proto, seen);
  }
}
