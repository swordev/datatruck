import { DataFormatType } from "../utils/DataFormat";
import { OptionsConfig, parseOptions } from "../utils/cli";
import type { Config } from "../utils/datatruck/config-type";
import { ProgressMode } from "../utils/progress";
import { Streams, createStreams } from "../utils/stream";
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
  readonly streams: Streams;
  constructor(
    readonly globalOptions: GlobalOptions<true>,
    readonly inputOptions: TUnresolvedOptions,
    streams: Partial<Streams> = {},
    readonly configPath?: string,
  ) {
    this.options = parseOptions(inputOptions, this.optionsConfig());
    this.streams = createStreams(streams);
  }
  abstract optionsConfig(): OptionsConfig<TUnresolvedOptions, TOptions>;
  protected castOptionsConfig(
    options: OptionsConfig<TUnresolvedOptions, TOptions>,
  ) {
    return options;
  }
  abstract exec(): Promise<{ exitCode: number; result?: any }>;
}
