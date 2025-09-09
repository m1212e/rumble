import { createPubSub } from "graphql-yoga";
import type { TableIdentifierTSName } from "./helpers/tableHelpers";
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
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>) => {
	const pubsub = subscriptions
		? createPubSub(...subscriptions)
		: createPubSub();

	const makePubSubInstance = <
		ExplicitTableName extends TableIdentifierTSName<DB>,
	>({
		table,
	}: {
		table: ExplicitTableName;
	}) => {
		type PrimaryKeyType = any;

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

		// TODO does caching these make sense?
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
					tableName: table.toString(),
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
					tableName: table.toString(),
					action: "created",
				});
				return pubsub.publish(key);
			},
			/**
			 * Call this when you removed one or more entities of this table
			 */
			// removed(primaryKeyValue?: PrimaryKeyType | PrimaryKeyType[]) {
			removed() {
				const key = makePubSubKey({
					tableName: table.toString(),
					action: "removed",
					//TODO would it make sense to use specific sub topics here?
					// primaryKeyValue,
				});
				return pubsub.publish(key);
			},
			/**
			 * Call this when you updated one or more entities of this table
			 */
			updated(primaryKeyValue?: PrimaryKeyType | PrimaryKeyType[]) {
				const primaryKeys = Array.isArray(primaryKeyValue)
					? primaryKeyValue
					: [primaryKeyValue];
				const keys = primaryKeys.map((primaryKeyValue) =>
					makePubSubKey({
						tableName: table.toString(),
						action: "updated",
						primaryKeyValue,
					}),
				);
				const uniqueKeys = Array.from(new Set(keys));
				for (const key of uniqueKeys) {
					pubsub.publish(key);
				}
			},
		};
	};

	return {
		pubsub,
		makePubSubInstance,
	};
};
