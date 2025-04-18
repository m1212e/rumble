import type { GetColumnData } from "drizzle-orm";
import { createPubSub } from "graphql-yoga";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

type PubSubAction = "created" | "removed" | "updated";

const SUBSCRIPTION_NOTIFIER_RUMBLE_PREFIX = "RUMBLE_SUBSCRIPTION_NOTIFICATION";
const SUBSCRIPTION_NOTIFIER_REMOVED = "REMOVED";
const SUBSCRIPTION_NOTIFIER_UPDATED = "UPDATED";
const SUBSCRIPTION_NOTIFIER_CREATED = "CREATED";

export type MakePubSubInstanceType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
	typeof createPubSubInstance<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>
>["makePubSubInstance"];

export const createPubSubInstance = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
>({
	subscriptions,
	db,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>) => {
	const pubsub = subscriptions
		? createPubSub(...subscriptions)
		: createPubSub();

	const makePubSubInstance = <
		ExplicitTableName extends keyof NonNullable<DB["_"]["schema"]>,
	>({
		tableName,
	}: {
		tableName: ExplicitTableName;
	}) => {
		type TablePrimaryKeyColumn = NonNullable<
			DB["_"]["schema"]
		>[ExplicitTableName]["primaryKey"][number];
		type PrimaryKeyType = GetColumnData<TablePrimaryKeyColumn, "raw">;

		function makePubSubKey({
			action,
			tableName,
			primaryKeyValue,
		}: {
			tableName: string;
			action: PubSubAction;
			primaryKeyValue?: PrimaryKeyType;
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

		return {
			/**
			 * Call this when you want to register a subscription on an instance to this table
			 */
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
			removed(primaryKeyValue?: PrimaryKeyType) {
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
			updated(primaryKeyValue?: PrimaryKeyType) {
				const key = makePubSubKey({
					tableName: tableName.toString(),
					action: "updated",
					primaryKeyValue,
				});
				return pubsub.publish(key);
			},
		};
	};

	return {
		pubsub,
		makePubSubInstance,
	};
};
