/**
 * Helper type to get the values of an object type as a union.
 */
export type ObjectValues<T> = T[keyof T];
