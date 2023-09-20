import { ConfigType } from "../Config/Config";
import { FormatType } from "../utils/DataFormat";
import { OptionsType, parseOptions } from "../utils/cli";
import { SimilarObject } from "../utils/ts";

export type GlobalOptionsType<TResolved = false> = {
  config: string | ConfigType;
  outputFormat?: FormatType;
  verbose?: number;
  progress?: "auto" | "plain" | "tty";
  progressInterval?: number;
};

export type CommandConstructorType<
  TUnresolvedOptions,
  TOptions extends SimilarObject<TUnresolvedOptions>,
> = {
  new (
    globalOptions: GlobalOptionsType<true>,
    options: TOptions,
  ): CommandAbstract<TUnresolvedOptions, TOptions>;
};

export abstract class CommandAbstract<
  TUnresolvedOptions,
  TOptions extends SimilarObject<TUnresolvedOptions>,
> {
  readonly options: TOptions;
  constructor(
    readonly globalOptions: GlobalOptionsType<true>,
    options: TUnresolvedOptions,
  ) {
    this.options = parseOptions(options, this.onOptions());
  }
  abstract onOptions(): OptionsType<TUnresolvedOptions, TOptions>;
  protected returnsOptions(options: OptionsType<TUnresolvedOptions, TOptions>) {
    return options;
  }
  abstract onExec(): Promise<number>;
}
