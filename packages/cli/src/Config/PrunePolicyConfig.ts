import { PruneActionsOptions } from "../Action/PruneAction";
import { SnapshotGroupByType } from "../Action/SnapshotsAction";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { JSONSchema7 } from "json-schema";

export const prunePolicyConfigDefinition: JSONSchema7 = {
  type: "object",
  properties: {
    keepDaily: { type: "integer" },
    keepHourly: { type: "integer" },
    keepMinutely: { type: "integer" },
    keepLast: { type: "integer" },
    keepMonthly: { type: "integer" },
    keepWeekly: { type: "integer" },
    keepYearly: { type: "integer" },
    groupBy: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "packageName",
          "repositoryName",
          "repositoryType",
        ] as SnapshotGroupByType[],
      },
    },
    tags: makeRef(DefinitionEnum.stringListUtil),
  },
};

export type PrunePolicyConfigType = Pick<
  PruneActionsOptions,
  | "keepDaily"
  | "keepHourly"
  | "keepMinutely"
  | "keepLast"
  | "keepMonthly"
  | "keepWeekly"
  | "keepYearly"
  | "groupBy"
  | "tags"
>;
