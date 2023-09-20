import type { ConfigType } from "../Config/Config";
import { ReadDataType } from "../SessionDriver/SessionDriverAbstract";
import { RestoreSessionManager } from "../SessionManager/RestoreSessionManager";
import { IfRequireKeys } from "../utils/ts";

export type RestoreSessionsActionOptionsType = ReadDataType & {
  verbose?: boolean;
};

export class RestoreSessionsAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<
      TRequired,
      RestoreSessionsActionOptionsType
    >,
  ) {}

  async exec(manager: RestoreSessionManager) {
    await manager.initDrivers();
    const result = await manager.readAll(this.options);
    await manager.endDrivers();
    return result;
  }
}
