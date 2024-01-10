import { DataFormatType } from "../utils/data-format";
import { OptionsConfig, parseOptions } from "../utils/cli";
import type { Config } from "../utils/datatruck/config-type";
import { ProgressMode } from "../utils/progress";
import { StdStreams, createStdStreams } from "../utils/stream";
import { If, SimilarObject } from "../utils/ts";

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

export type CommandConstructor<
  TUnresolvedOptions,
  TOptions extends SimilarObject<TUnresolvedOptions>,
> = {
  new (
    globalOptions: GlobalOptions<true>,
    options: TOptions,
  ): CommandAbstract<TUnresolvedOptions, TOptions>;
};

export abstract class CommandAbstract<
  TUnresolvedOptions,
  TOptions extends SimilarObject<TUnresolvedOptions>,
> {
  readonly options: TOptions;
  readonly streams: StdStreams;
  constructor(
    readonly globalOptions: GlobalOptions<true>,
    readonly inputOptions: TUnresolvedOptions,
    streams: Partial<StdStreams> = {},
    readonly configPath?: string,
  ) {
    this.options = parseOptions(inputOptions, this.optionsConfig());
    this.streams = createStdStreams(streams);
  }
  abstract optionsConfig(): OptionsConfig<TUnresolvedOptions, TOptions>;
  protected castOptionsConfig(
    options: OptionsConfig<TUnresolvedOptions, TOptions>,
  ) {
    return options;
  }
  abstract exec(): Promise<{ exitCode: number; result?: any }>;
}
