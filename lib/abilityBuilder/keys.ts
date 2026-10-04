// per row: the index of the action the row was loaded with
export const ACTION_FLAG_KEY = "__rumble_action";
// per row and column group: 1 if the row matches one of the group's abilities
export const columnFlagKey = (group: number) => `__rumble_columns_${group}`;

export const columnMaskKey = Symbol.for("rumble:columnMask");
export const resolvedFilterKey = Symbol.for("rumble:resolvedFilter");

// the masking state of a request, on its abilities
export const requestStateKey = Symbol.for("rumble:requestState");
