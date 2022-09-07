import { SessionDriverAbstract } from "../SessionDriver/SessionDriverAbstract";

export type OptionsType = {
  driver: SessionDriverAbstract;
  altDrivers?: SessionDriverAbstract[];
  progressInterval?: number;
  verbose?: boolean;
};

export default abstract class SessionManagerAbstract {
  protected lastProgressDate: number | undefined;
  protected lastRelativeProgressDescription: string | null | undefined;
  protected progressTimeout: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly options: OptionsType) {}

  protected stopDelayedProgress() {
    clearTimeout(this.progressTimeout);
    this.progressTimeout = undefined;
  }

  protected delayProgress(cb: () => Promise<any>) {
    clearTimeout(this.progressTimeout);
    this.progressTimeout = setTimeout(async () => {
      this.progressTimeout = undefined;
      await cb();
    }, 1_500);
  }

  protected checkProgress(description: string | null | undefined) {
    const progressInterval = this.options.progressInterval;
    if (progressInterval) {
      const skip =
        this.lastProgressDate &&
        description === this.lastRelativeProgressDescription &&
        Date.now() - this.lastProgressDate < progressInterval;
      if (skip) return false;
      this.lastProgressDate = Date.now();
      this.lastRelativeProgressDescription = description;
    }
    return true;
  }
}
