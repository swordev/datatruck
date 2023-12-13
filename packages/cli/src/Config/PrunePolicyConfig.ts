import { PruneActionsOptions } from "../actions/PruneAction";

export type PrunePolicyConfig = Pick<
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
