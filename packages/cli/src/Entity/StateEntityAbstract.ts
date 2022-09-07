import { Progress } from "../util/progress";
import { CrudEntityAbstract } from "./CrudEntityAbstract";

export abstract class StateEntityAbstract extends CrudEntityAbstract {
  state!: "started" | "ended" | null;
  error?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  progress?: Progress;
}
