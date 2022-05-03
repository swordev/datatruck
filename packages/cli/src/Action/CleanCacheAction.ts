import { existsDir, parentTmpDir } from "../util/fs-util";
import { IfRequireKeys } from "../util/ts-util";
import { rm } from "fs/promises";

export type CleanCacheActionOptionsType = {
  verbose?: boolean;
};

export class CleanCacheAction<TRequired extends boolean = true> {
  constructor(
    readonly options: IfRequireKeys<TRequired, CleanCacheActionOptionsType>
  ) {}
  async exec() {
    const path = parentTmpDir();
    if (await existsDir(path))
      await rm(path, {
        recursive: true,
      });
  }
}
