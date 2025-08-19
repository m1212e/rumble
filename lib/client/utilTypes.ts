export type UnArray<T> = T extends Array<infer U> ? U : T;

export type UnArrayFields<T> = {
	[K in keyof T]: T[K] extends Array<any> ? UnArray<T[K]> : T[K];
};
