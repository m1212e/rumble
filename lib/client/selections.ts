import type { User } from "../../example/src/generated-client/graphql";

type RelationType = object | Array<object>;

/**
 * Can be used to transform a set of keys into a selector which can be chained
 */
export type Selector<Object extends Record<string, any>> = InternalSelector<
	Object,
	Object
>;

type UnArray<T> = T extends Array<infer U> ? U : T;

type InternalSelector<
	ExcludedObject extends Record<string, any>,
	OriginalObject extends Record<string, any>,
> = {
	[SelectedFieldKey in keyof ExcludedObject &
		keyof OriginalObject]: OriginalObject[SelectedFieldKey] extends RelationType
		? (
				relationSelectorFunction: (
					relationSelector: InternalSelector<
						UnArray<OriginalObject[SelectedFieldKey]>,
						OriginalObject
					>,
				) => InternalSelector<
					UnArray<OriginalObject[SelectedFieldKey]>,
					OriginalObject
				>,
			) => ReducedSelectorFieldValue<
				ExcludedObject,
				OriginalObject,
				SelectedFieldKey
			>
		: ReducedSelectorFieldValue<
				ExcludedObject,
				OriginalObject,
				SelectedFieldKey
			>;
};

type ReducedSelectorFieldValue<
	ExcludedObject extends Record<string, any>,
	OriginalObject extends Record<string, any>,
	SelectedFieldKey extends keyof ExcludedObject,
> = InternalSelector<
	{
		[k in Exclude<
			keyof ExcludedObject,
			SelectedFieldKey
		>]: ExcludedObject[SelectedFieldKey];
	},
	OriginalObject
>;

// (s: Selector<OriginalObjectType[K]>) => Selector<OriginalObjectType[K]>

// type InternalSelector<
// 	Key extends string | number | symbol,
// 	OriginalObjectType extends Record<Key, any>,
// 	RecursiveObjectType extends Record<Key, any>,
// > = {
// 	[K in Key]: OriginalObjectType[K] extends RelationType
// 		? RelationSelectorFunction<OriginalObjectType[K]>
// 		: InternalSelector<{
// 				[k in Exclude<keyof Object, K>]: RecursiveObjectType[K];
// 			}>;
// };

/**
 * Applies a selector to a response type, retaining only the selected fields
 */
export type ApplySelector<
	Object extends Record<string, any>,
	Selection extends Selector<Record<string, any>>,
> = {
	[K in Exclude<keyof Object, keyof Selection>]: Object[K];
};

export function makeSelector<Object extends Record<string, any>>() {
	const selectedFields: (keyof Object)[] = [];
	const selectionProxy = new Proxy(
		{},
		{
			get: (target, prop) => {
				if (typeof prop === "symbol") {
					console.warn(
						"The selector seems to be have called with a symbol instead of a string, this is incorrect and cannot be handled",
					);
					return selectionProxy;
				}

				selectedFields.push(prop as keyof Object);
				return selectionProxy;
			},
		},
	) as Selector<Object>;

	return { selectionProxy, selectedFields };
}
