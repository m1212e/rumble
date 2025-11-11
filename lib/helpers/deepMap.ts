/**
 * Recursively applies a mapping function to every value in a nested structure.
 *
 * This helper will traverse arrays and plain objects (objects with `constructor === Object`)
 * and apply the provided `fn` to any value that is not an array or a plain object.
 * - Arrays are mapped to new arrays (a fresh array is returned).
 * - Plain objects are traversed and their own enumerable properties are replaced in-place.
 * - Non-plain objects (e.g. Date, Map, Set, class instances, functions) are treated as leaves
 *   and passed directly to `fn`.
 * - `null` and `undefined` are passed to `fn`.
 * - Circular references are detected using a `WeakSet`. When a circular reference is encountered,
 *   the original reference is returned unchanged (it is not re-traversed or re-mapped).
 *
 * Note: Because plain objects are mutated in-place, callers who need immutability should first
 * clone the object graph or pass a deep-cloned input to avoid modifying the original.
 *
 * @param input - The value to traverse and map. May be any value (primitive, array, object, etc.).
 * @param fn - A function invoked for every non-array, non-plain-object value encountered.
 *             Receives the current value and should return the mapped value.
 * @returns The transformed structure: arrays are returned as new arrays, plain objects are the
 *          same object instances with their property values replaced, and other values are the
 *          result of `fn`.
 *
 * @example
 * // Map all primitive values to their string representation:
 * // const result = mapValuesDeep({ a: 1, b: [2, { c: 3 }] }, v => String(v));
 * // result => { a: "1", b: ["2", { c: "3" }] }
 *
 * @remarks
 * - Only plain objects (constructed by `Object`) are recursively traversed. This avoids
 *   unintentionally iterating internal structure of class instances or built-in collections.
 * - Circular structures are preserved by returning the original reference when detected.
 */
export function mapValuesDeep(input: any, fn: (value: any) => any) {
  const seen = new WeakSet();

  const recurse = (value: any): any => {
    if (Array.isArray(value)) {
      return value.map(recurse);
    }

    if (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      value.constructor === Object
    ) {
      if (seen.has(value)) return value;
      seen.add(value);
      for (const key of Object.keys(value)) {
        value[key] = recurse(value[key]);
      }
      return value;
    }

    return fn(value);
  };

  return recurse(input);
}
