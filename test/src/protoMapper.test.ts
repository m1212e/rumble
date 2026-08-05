import { describe, expect, test } from "bun:test";
import { deepSetProto } from "../../lib/helpers/protoMapper";

describe("deepSetProto", () => {
  test("normalizes a null-prototype plain object to Object.prototype", () => {
    const obj = Object.create(null) as Record<string, unknown>;
    obj.foo = "bar";

    deepSetProto(obj);

    expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
  });

  test("recurses into nested plain objects", () => {
    const inner = Object.create(null) as Record<string, unknown>;
    inner.gte = "2007-12-03T10:15:30Z";
    const outer = { where: { validityStart: inner } };

    deepSetProto(outer);

    expect(Object.getPrototypeOf(inner)).toBe(Object.prototype);
  });

  test("leaves Date instances untouched so toISOString keeps working", () => {
    const date = new Date("2007-12-03T10:15:30Z");
    const where = { validityStart: { gte: date } };

    deepSetProto(where);

    expect(Object.getPrototypeOf(date)).toBe(Date.prototype);
    expect(() => date.toISOString()).not.toThrow();
    expect(date.toISOString()).toBe("2007-12-03T10:15:30.000Z");
  });

  test("leaves RegExp instances untouched", () => {
    const regex = /abc/;
    const wrapper = { pattern: regex };

    deepSetProto(wrapper);

    expect(Object.getPrototypeOf(regex)).toBe(RegExp.prototype);
  });

  test("recurses into arrays without altering Array.prototype", () => {
    const inner = Object.create(null) as Record<string, unknown>;
    inner.value = 1;
    const arr = [inner, new Date()];

    deepSetProto(arr);

    expect(Object.getPrototypeOf(arr)).toBe(Array.prototype);
    expect(Object.getPrototypeOf(inner)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(arr[1])).toBe(Date.prototype);
  });
});
