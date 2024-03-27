import { DataFormatType } from "../utils/data-format";
import type { Config } from "../utils/datatruck/config-type";
import { CommandConfig, InferOptions, OptionsConfig } from "../utils/options";
import { ProgressMode } from "../utils/progress";
import { StdStreams, createStdStreams } from "../utils/stream";
import { If } from "../utils/ts";

export type GlobalOptions<TResolved = false> = {
  config: string | Config;
  outputFormat?: DataFormatType;
  verbose?: number;
  tty?: If<TResolved, "auto" | boolean, "auto" | "true" | "false">;
  progress?: If<
    TResolved,
    ProgressMode,
    Exclude<ProgressMode, boolean> | "true" | "false"
  >;
};

export type CommandConstructor<T extends OptionsConfig = OptionsConfig> = {
  new (
    globalOptions: GlobalOptions<true>,
    options: InferOptions<T>,
    streams?: Partial<StdStreams>,
    configPath?: string,
  ): CommandAbstract<T>;
  config(): CommandConfig;
};

export abstract class CommandAbstract<T extends OptionsConfig = OptionsConfig> {
  readonly streams: StdStreams;
  abstract optionsConfig: T;
  static config(): CommandConfig {
    throw new Error("Not implemented");
  }
  constructor(
    readonly globalOptions: GlobalOptions<true>,
    readonly options: InferOptions<T>,
    streams: Partial<StdStreams> = {},
    readonly configPath?: string,
  ) {
    this.streams = createStdStreams(streams);
  }
  abstract exec(): Promise<{
    exitCode: number;
    result?: any;
    errors?: Error[];
  }>;
}
