import { tableHelper } from "../helpers/tableHelpers";
import type { TelemetryConfig } from "../helpers/telemetry";
import type { Filter } from "../runtimeFiltersPlugin/filterTypes";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
  DrizzleTableValueType,
  TableRelationNames,
} from "../types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "../types/rumbleInput";
import { createColumnMasker, type MaskColumnsInput } from "./columnMask";
import { attachRequestState, createRequestState } from "./requestState";
import { createTableAbilities } from "./tableAbilities";
import { createTableBuilder } from "./tableBuilder";
import { makeNothingRegisteredWarner } from "./telemetry";
import type { AbilitySettings } from "./types";

export type { ColumnMask } from "./columnMask";
export { columnMaskKey } from "./keys";

//TODO: optimize this for v8

export type AbilityBuilderType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
  typeof createAbilityBuilder<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >
>;

export const createAbilityBuilder = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>({
  db,
  actions,
  defaultLimit,
  otel,
  logger: loggerConfig,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>) => {
  type TableNames = TableRelationNames<DB>;

  const log = loggerConfig?.enabled ? loggerConfig.logger : undefined;
  const telemetryConfig: TelemetryConfig = { otel, logger: loggerConfig };
  const settings: AbilitySettings<DB, Action> = {
    db,
    // populated by rumble() when the user does not pass any
    actions: actions!,
    defaultLimit,
    otel,
    telemetryConfig,
    log,
    warnNothingRegistered: makeNothingRegisteredWarner(telemetryConfig, log),
  };

  // Views/materialized views can appear in db.query (if the caller's schema
  // includes them)
  const tableRelationNames = (
    Object.keys(db.query) as (keyof DrizzleQueryFunction<DB>)[]
  ).filter(
    (name) => tableHelper({ db, table: name as any }).isTable,
  ) as TableNames[];

  let hasBeenBuilt = false;

  const buildersPerTable = Object.fromEntries(
    tableRelationNames.map((tableName) => [
      tableName,
      createTableBuilder<UserContext, DB, Action, typeof tableName>({
        actions: settings.actions,
        isBuilt: () => hasBeenBuilt,
      }),
    ]),
  ) as {
    [key in TableNames]: ReturnType<
      typeof createTableBuilder<UserContext, DB, Action, key>
    >;
  };

  const { maskColumns, maskedActions, primaryKeyHidden } = createColumnMasker(
    settings,
    new Map(
      tableRelationNames.map((tableName) => {
        const tableSchema = tableHelper({ db, table: tableName });
        return [
          tableName,
          {
            columns: Object.keys(tableSchema.columns),
            primaryKey: Object.keys(tableSchema.primaryKey),
          },
        ];
      }),
    ),
  );

  const readActionPerTable = new Map<TableNames, Action>();

  return {
    ...buildersPerTable,
    /**
     * @internal
     * @ignore
     */
    _: {
      maskColumns: (input: MaskColumnsInput<DB, Action>) => maskColumns(input),
      /** The actions rows of the table were masked with in this request. */
      maskedActions: (abilities: object, table: TableNames) =>
        maskedActions(abilities, table),
      /** Whether masking in this request hid the primary key of the row. */
      primaryKeyHidden: (abilities: object, row: object) =>
        primaryKeyHidden(abilities, row),
      registerReadAction(table: TableNames, action: Action) {
        readActionPerTable.set(table, action);
      },
      readActionOf(table: TableNames): Action {
        return readActionPerTable.get(table) ?? ("read" as Action);
      },
      registeredFilters({
        action,
        table,
      }: {
        table: TableNames;
        action: Action;
      }) {
        return (buildersPerTable[table] as any)._.runtimeFilters.get(
          action,
        )! as Filter<UserContext, DrizzleTableValueType<DB, TableNames>>[];
      },
      build() {
        const abilitiesPerTable = Object.fromEntries(
          tableRelationNames.map((tableName) => [
            tableName,
            createTableAbilities<UserContext, DB, Action, typeof tableName>(
              settings,
              tableName,
              buildersPerTable[tableName]._.queryFilters,
            ),
          ]),
        ) as {
          [key in TableNames]: ReturnType<
            typeof createTableAbilities<UserContext, DB, Action, key>
          >;
        };

        hasBeenBuilt = true;

        return (ctx: UserContext) => {
          const state = createRequestState<Action>();
          const abilities = Object.fromEntries(
            tableRelationNames.map((tableName) => [
              tableName,
              abilitiesPerTable[tableName].withContext(ctx, state.id),
            ]),
          ) as {
            [key in TableNames]: ReturnType<
              ReturnType<
                typeof createTableAbilities<UserContext, DB, Action, key>
              >["withContext"]
            >;
          };
          attachRequestState(abilities, state);
          return abilities;
        };
      },
    },
  };
};
