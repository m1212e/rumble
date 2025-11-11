import type { Exchange } from "@urql/core";
import { map, pipe } from "wonka";
import { mapValuesDeep } from "../helpers/deepMap";

const dateIsoRegex =
  /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$/;

export const nativeDateExchange: Exchange = ({ client, forward }) => {
  return (operations$) => {
    const operationResult$ = forward(operations$);

    return pipe(
      operationResult$,
      map((r) => {
        r.data = mapValuesDeep(r.data, (value) => {
          if (typeof value !== "string" || !dateIsoRegex.test(value)) {
            return value;
          }

          const date = Date.parse(value);
          if (!Number.isNaN(date)) {
            return new Date(date);
          }

          return value;
        });
        return r;
      }),
    );
  };
};
