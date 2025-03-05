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
	specificEntityId,
}: {
	tableName: string;
	action: PubSubAction;
	specificEntityId?: string;
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
		specificEntityId ? `/${specificEntityId}` : ""
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
		subscribe(params: { action: PubSubAction; specificEntityId?: any }) {
			return pubsub.subscribe(
				makePubSubKey({
					action: params.action,
					tableName: tableName.toString(),
					specificEntityId: params.specificEntityId,
				}),
			);
		},
		registerOnInstance({
			instance,
			action,
			specificEntityId,
		}: {
			instance: { register: (id: string) => void };
			action: PubSubAction;
			specificEntityId?: string;
		}) {
			instance.register(
				makePubSubKey({
					tableName: tableName.toString(),
					action,
					specificEntityId,
				}),
			);
		},
		/**
		 * Call this when you created an entity of this table
		 */
		created(specificEntityId?: any) {
			return pubsub.publish(
				makePubSubKey({
					tableName: tableName.toString(),
					action: "created",
					specificEntityId,
				}),
			);
		},
		/**
		 * Call this when you removed an entity of this table
		 */
		removed(specificEntityId?: any) {
			return pubsub.publish(
				makePubSubKey({
					tableName: tableName.toString(),
					action: "removed",
					specificEntityId,
				}),
			);
		},
		/**
		 * Call this when you updated an entity of this table
		 */
		updated(specificEntityId?: any) {
			return pubsub.publish(
				makePubSubKey({
					tableName: tableName.toString(),
					action: "updated",
					specificEntityId,
				}),
			);
		},
	});

	return {
		pubsub,
		makePubSubInstance,
	};
};
