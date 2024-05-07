import { parseStringList } from "./string";
import { Argument, Option, program } from "commander";

export type OptionsConfigObject = {
  flag?: string | false;
  shortFlag?: string;
  description: string;
  required?: boolean;
  defaults?: any;
  value?: "boolean" | "number" | "string" | "array" | ((value: string) => any);
};

export type OptionsConfig = Record<string, OptionsConfigObject>;

export type InferOptionsValue<O extends OptionsConfigObject> = [
  O["value"],
] extends ["number"]
  ? number
  : [O["value"]] extends ["boolean"]
    ? boolean
    : [O["value"]] extends ["array"]
      ? string[]
      : O["value"] extends (value: any) => any
        ? ReturnType<O["value"]>
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

  if (config.alias) command.alias(config.alias);

  for (const name in config.options) {
    const option = config.options[name];
    const flag = option.flag ?? name;

    const description = `${option.description}${
      option.defaults ? ` (defaults: ${option.defaults})` : ""
    }`;

    if (flag === false) {
      const arg = new Argument(name, description);
      if (option.required) {
        arg.argRequired();
      } else {
        arg.argOptional();
      }
      command.addArgument(arg);
      argumentOptions.push(name);
    } else if (typeof flag === "string") {
      const flags = [
        option.shortFlag ? `-${option.shortFlag},` : "",
        `--${name}`,
        option.value !== "boolean"
          ? option.value === "array"
            ? " <values>"
            : " <value>"
          : "",
      ].join("");

      const opt = new Option(flags, description);
      opt.makeOptionMandatory(!!option.required);
      command.addOption(opt);
    }
  }
  const parsers: Record<string, (input: any) => any> = {
    number: Number,
    array: parseStringList,
  };
  return command.action(async (...args: any[]) => {
    const inlineValues = args.slice(0, argumentOptions.length);
    const cliOptions = args[argumentOptions.length] || {};
    const commandOptions = {} as Record<string, any>;
    for (const name in config.options) {
      const option = config.options[name];
      if (option.flag !== false) {
        const parse =
          typeof option.value === "string"
            ? parsers[option.value]
            : option.value;
        const cliValue = cliOptions[option.flag ?? name] ?? option.defaults;
        if (cliValue !== undefined)
          commandOptions[name] = parse ? parse(cliValue) : cliValue;
      }
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

  for (const name in options) {
    const option = options[name];
    const value = object[name];
    if (value === undefined) continue;

    if (option.flag === false) {
      prepend.push(value);
    } else {
      const flag = option.shortFlag
        ? `-${option.shortFlag}`
        : `--${option.flag ?? name}`;

      if (option.value === "boolean") {
        if (option.value) result.push(flag);
      } else {
        result.push(flag);
        result.push(`${value}`);
      }
    }
  }
  return [...prepend, ...result];
}
