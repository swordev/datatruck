import { Config } from "../Config/Config";
import { DataFormatType } from "../utils/DataFormat";
import { OptionsType, parseOptions } from "../utils/cli";
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
    options: TUnresolvedOptions,
    streams: Partial<Streams> = {},
    readonly configPath?: string,
  ) {
    this.options = parseOptions(options, this.onOptions());
    this.streams = createStreams(streams);
  }
  abstract onOptions(): OptionsType<TUnresolvedOptions, TOptions>;
  protected returnsOptions(options: OptionsType<TUnresolvedOptions, TOptions>) {
    return options;
  }
  abstract onExec(): Promise<number>;
}
