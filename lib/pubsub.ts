import { createPubSub } from "graphql-yoga";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";

type PubSubAction = "created" | "removed" | "updated";

const SUBSCRIPTION_NOTIFIER_RUMBLE_PREFIX = "RUMBLE_SUBSCRIPTION_NOTIFICATION";
const SUBSCRIPTION_NOTIFIER_REMOVED = "REMOVED";
const SUBSCRIPTION_NOTIFIER_UPDATED = "UPDATED";
const SUBSCRIPTION_NOTIFIER_CREATED = "CREATED";

function makePubSubKey({
	action,
	tableName,
	primaryKeyValue,
}: {
	tableName: string;
	action: PubSubAction;
	primaryKeyValue?: string;
}) {
	let actionKey: string;

	switch (action) {
		case "created":
			actionKey = SUBSCRIPTION_NOTIFIER_CREATED;
			break;
		case "removed":
			actionKey = SUBSCRIPTION_NOTIFIER_REMOVED;
			break;
		case "updated":
			actionKey = SUBSCRIPTION_NOTIFIER_UPDATED;
			break;
		default:
			throw new Error(`Unknown action: ${action}`);
	}

	return `${SUBSCRIPTION_NOTIFIER_RUMBLE_PREFIX}/${tableName}${
		primaryKeyValue ? `/${primaryKeyValue}` : ""
	}/${actionKey}`;
}

export type MakePubSubInstanceType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
> = ReturnType<
	typeof createPubSubInstance<UserContext, DB, RequestEvent, Action>
>["makePubSubInstance"];

export const createPubSubInstance = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
>({
	subscriptions,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {}) => {
	const pubsub = subscriptions
		? createPubSub(...subscriptions)
		: createPubSub();

	const makePubSubInstance = <
		ExplicitTableName extends keyof NonNullable<DB["_"]["schema"]>,
	>({
		tableName,
	}: {
		tableName: ExplicitTableName;
	}) => ({
		/**
		 * Subscribe to an entity/event of this table
		 */
		subscribe(params: { action: PubSubAction; primaryKeyValue?: any }) {
			return pubsub.subscribe(
				makePubSubKey({
					action: params.action,
					tableName: tableName.toString(),
					primaryKeyValue: params.primaryKeyValue,
				}),
			);
		},
		registerOnInstance({
			instance,
			action,
			primaryKeyValue,
		}: {
			instance: { register: (id: string) => void };
			action: PubSubAction;
			primaryKeyValue?: string;
		}) {
			const key = makePubSubKey({
				tableName: tableName.toString(),
				action,
				primaryKeyValue,
			});
			instance.register(key);
		},
		/**
		 * Call this when you created an entity of this table
		 */
		created() {
			const key = makePubSubKey({
				tableName: tableName.toString(),
				action: "created",
			});
			return pubsub.publish(key);
		},
		/**
		 * Call this when you removed an entity of this table
		 */
		removed(primaryKeyValue?: any) {
			const key = makePubSubKey({
				tableName: tableName.toString(),
				action: "removed",
				// primaryKeyValue,
			});
			return pubsub.publish(key);
		},
		/**
		 * Call this when you updated an entity of this table
		 */
		updated(primaryKeyValue?: any) {
			const key = makePubSubKey({
				tableName: tableName.toString(),
				action: "updated",
				primaryKeyValue,
			});
			return pubsub.publish(key);
		},
	});

	return {
		pubsub,
		makePubSubInstance,
	};
};
