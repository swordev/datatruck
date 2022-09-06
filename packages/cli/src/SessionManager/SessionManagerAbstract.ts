import { SessionDriverAbstract } from "../SessionDriver/SessionDriverAbstract";

export type OptionsType = {
  driver: SessionDriverAbstract;
  altDrivers?: SessionDriverAbstract[];
  progressInterval?: number;
  verbose?: boolean;
};

export default abstract class SessionManagerAbstract {
  protected lastProgressDate: number | undefined;
  protected lastProgressStepDescription: string | null | undefined;
  constructor(readonly options: OptionsType) {}
  protected checkProgress(description: string | null | undefined) {
    const progressInterval = this.options.progressInterval;
    if (progressInterval) {
      const skip =
        this.lastProgressDate &&
        description === this.lastProgressStepDescription &&
        Date.now() - this.lastProgressDate < progressInterval;
      if (skip) return false;
      this.lastProgressDate = Date.now();
      this.lastProgressStepDescription = description;
    }
    return true;
  }
}
