import type { ConfigType } from "../Config/Config";
import { ReadDataType } from "../SessionDriver/SessionDriverAbstract";
import { BackupSessionManager } from "../SessionManager/BackupSessionManager";
import { IfRequireKeys } from "../utils/ts";

export type BackupSessionsActionOptionsType = ReadDataType & {
  verbose?: boolean;
};

export class BackupSessionsAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, BackupSessionsActionOptionsType>
  ) {}

  async exec(session: BackupSessionManager) {
    await session.initDrivers();
    const result = await session.readAll(this.options);
    await session.endDrivers();
    return result;
  }
}
