import { CrudEntityAbstract } from "./CrudEntityAbstract";

export abstract class StateEntityAbstract extends CrudEntityAbstract {
  state!: "started" | "ended" | null;
  error?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  progressTotal?: number | null;
  progressCurrent?: number | null;
  progressPercent?: number | null;
  progressStep?: string | null;
  progressStepPercent?: number | null;
}
