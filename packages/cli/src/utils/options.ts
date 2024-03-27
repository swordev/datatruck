import { camelize } from "./string";
import { Argument, program } from "commander";

export type OptionsConfigObject = {
  option?: string;
  description: string;
  required?: boolean;
  boolean?: boolean;
  defaults?: any;
  parser?: (value: string) => any;
};

export type OptionsConfig = Record<string, OptionsConfigObject>;

export type InferOptionsValue<O extends OptionsConfigObject> =
  O["parser"] extends (value: any) => any
    ? ReturnType<O["parser"]>
    : [O["boolean"]] extends [true]
      ? boolean
      : string;

export type InferOptions<T extends OptionsConfig> = {
  [K in keyof T as [T[K]["required"]] extends [true]
    ? K
    : never]: InferOptionsValue<T[K]>;
} & {
  [K in keyof T as [T[K]["required"]] extends [true]
    ? never
    : K]?: InferOptionsValue<T[K]>;
};

export type CommandConfig<T extends OptionsConfig = OptionsConfig> = {
  name: string;
  alias?: string;
  options: T;
};

export function createCommand<T extends OptionsConfig>(
  config: CommandConfig<T>,
  action: (options: InferOptions<T>) => any,
) {
  const command = program.createCommand(config.name);
  const argumentOptions: string[] = [];

  for (const name in config.options) {
    const option = config.options[name];
    if (typeof option.option !== "string") {
      const arg = new Argument(name);
      if (option.required) {
        arg.argRequired();
      } else {
        arg.argOptional();
      }
      command.addArgument(arg);
      argumentOptions.push(name);
    }
  }

  if (config.alias) command.alias(config.alias);

  for (const key in config.options) {
    const option = config.options[key];
    if (typeof option.option === "string") {
      const description = `${option.description}${
        option.defaults ? ` (defaults: ${option.defaults})` : ""
      }`;
      if (option.required) {
        command.requiredOption(
          option.option,
          description,
          option.parser as any,
        );
      } else {
        command.option(option.option, description, option.parser as any);
      }
    }
  }

  const optionNameMap: Record<string, string> = {};

  for (const optionName in config.options) {
    const option = config.options[optionName];
    if (typeof option.option === "string") {
      const matches = option.option.match(/--([\w\-]+)/i);
      if (matches) {
        optionNameMap[camelize(matches[1])] = optionName;
      }
    }
  }

  return command.action(async (...args: any[]) => {
    const inlineValues = args.slice(0, argumentOptions.length);
    const cliOptions = args[argumentOptions.length] || {};

    const commandOptions = {} as Record<string, any>;
    for (const cliName in optionNameMap) {
      const name = optionNameMap[cliName];
      commandOptions[name] = cliOptions[cliName];
    }

    const options = argumentOptions.reduce((result, inlineOption, index) => {
      const value = inlineValues[index];
      if (value !== undefined) result[inlineOption] = value;
      return result;
    }, commandOptions);
    return await action(options as any);
  });
}

export function stringifyOptions(options: OptionsConfig, object: any) {
  const result: string[] = [];
  const prepend: string[] = [];
  for (const key in options) {
    const fullOpt = options[key].option;
    if (typeof fullOpt === "string") {
      const [opt] = fullOpt.split(",");
      const isNegative = fullOpt.startsWith("--no");
      const isBool = !fullOpt.includes("<") && !fullOpt.includes("[");
      const defaultsValue = isNegative ? true : options[key].defaults;
      const value = object?.[key] ?? defaultsValue;

      if (isBool) {
        if (object[key]) result.push(opt);
      } else if (value !== undefined) {
        result.push(opt, `${value}`);
      }
    } else {
      const value = object?.[key];
      if (value !== undefined) prepend.push(value);
    }
  }
  return [...prepend, ...result];
}
