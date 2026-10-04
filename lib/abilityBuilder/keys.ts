// per row: actionIndex + actionCount * bits of the matched column groups
export const COLUMN_FLAG_KEY = "__rumble_columns";

// per row: the id of the request the column flag was computed for
export const COLUMN_REQUEST_KEY = "__rumble_request";

export const columnMaskKey = Symbol.for("rumble:columnMask");
export const resolvedFilterKey = Symbol.for("rumble:resolvedFilter");

// the masking state of a request, on its abilities
export const requestStateKey = Symbol.for("rumble:requestState");
