// per row: actionIndex + actionCount * bits of the matched column groups
export const COLUMN_FLAG_KEY = "__rumble_columns";

export const columnMaskKey = Symbol.for("rumble:columnMask");
export const resolvedFilterKey = Symbol.for("rumble:resolvedFilter");

// A second pass in the same request would see the cleared flag and hide the
// conditionally granted columns. Rows reused by another request are masked again.
export const maskedByKey = Symbol.for("rumble:maskedBy");

// set on masked rows whose primary key the ability does not grant
export const hiddenPrimaryKeyKey = Symbol.for("rumble:hiddenPrimaryKey");
