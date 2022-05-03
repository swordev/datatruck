import { FormatType } from "../util/DataFormat";
import { OptionsType, parseOptions } from "../util/cli-util";
import { If, SimilarObject } from "../util/ts-util";

export type GlobalOptionsType<TResolved = false> = {
  config: string;
  outputFormat?: FormatType;
  verbose?: number;
};

export type CommandConstructorType<
  TUnresolvedOptions,
  TOptions extends SimilarObject<TUnresolvedOptions>
> = {
  new (
    globalOptions: GlobalOptionsType<true>,
    options: TOptions
  ): CommandAbstract<TUnresolvedOptions, TOptions>;
};

export abstract class CommandAbstract<
  TUnresolvedOptions,
  TOptions extends SimilarObject<TUnresolvedOptions>
> {
  readonly options: TOptions;
  constructor(
    readonly globalOptions: GlobalOptionsType<true>,
    options: TUnresolvedOptions
  ) {
    this.options = parseOptions(options, this.onOptions());
  }
  abstract onOptions(): OptionsType<TUnresolvedOptions, TOptions>;
  protected returnsOptions(options: OptionsType<TUnresolvedOptions, TOptions>) {
    return options;
  }
  abstract onExec(): Promise<number>;
}
