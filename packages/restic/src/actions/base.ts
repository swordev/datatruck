import { Config, ConfigManager, GlobalConfig } from "../config.js";
import { Ntfy } from "../utils/ntfy.js";

export class Action {
  readonly ntfy: Ntfy;
  protected verbose: boolean | undefined;
  protected cm: ConfigManager;
  constructor(
    readonly config: Config,
    readonly global?: GlobalConfig,
  ) {
    this.cm = new ConfigManager(this.config);
    this.verbose = this.global?.verbose ?? this.config.verbose;
    this.ntfy = new Ntfy({
      token: this.config.ntfyToken,
      titlePrefix: this.config.hostname,
    });
  }
}
