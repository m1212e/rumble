export function deepSetProto(
  obj: any,
  proto = Object.prototype,
  seen = new WeakSet(),
) {
  if (obj === null || typeof obj !== "object") return;
  if (seen.has(obj)) return;
  seen.add(obj);
  Object.setPrototypeOf(obj, proto);
  for (const key of Object.keys(obj)) {
    deepSetProto(obj[key], proto, seen);
  }
}
