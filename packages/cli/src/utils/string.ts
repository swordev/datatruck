import { AppError } from "../Error/AppError";
import { isMatch } from "micromatch";

export function serialize(message: string, data?: Object) {
  if (data) return `${message} (${JSON.stringify(data, null, 2)})`;
  return message;
}

export function snakeCase(value: string, char = "_") {
  return value.replace(/[A-Z]/g, (letter) => `${char}${letter.toLowerCase()}`);
}

export function render(
  subject: string,
  vars: Record<string, string | undefined>,
) {
  return subject.replace(/{([\w/]*)}/g, function (match, name) {
    if (!name.length) {
      return "{";
    } else if (name === "/") {
      return "}";
    }
    const value = vars[name];
    if (typeof value === "undefined")
      throw new AppError(`Variable is not defined: '${subject}' (${name})`);
    return value;
  });
}

export function parseStringList<T>(
  value: string | undefined,
  validValues?: T[],
  defaultsValues?: T[] | true,
): T[] {
  const resultFallback =
    (defaultsValues === true ? validValues : defaultsValues) ?? [];
  const result =
    value
      ?.split(",")
      .map((v) => v.trim())
      .filter((v) => !!v.length) ?? resultFallback;
  if (validValues)
    for (const v of result)
      if (!validValues.includes(v as T))
        throw new AppError(`Invalid value: ${v}`);
  return result as T[];
}

export type UriType = {
  protocol?: "http" | "https";
  host?: string;
  username?: string;
  password?: string;
  port?: number;
  path?: string;
};

export function formatUri(input: UriType, hidePassword?: boolean) {
  let uri = "";
  if (input.protocol) {
    uri = `${input.protocol}://`;
    if (input.username) {
      uri += `${input.username}`;
      if (input.password)
        uri += `:${hidePassword ? "********" : input.password}`;
      uri += `@`;
    }
    if (input.host) uri += input.host;
    if (input.port) uri += `:${input.port}`;
  }
  if (input.path) uri += input.path;
  return uri;
}

export function formatSeconds(seconds: number) {
  let unit: string;
  let value: number;
  if (seconds > 60 * 60) {
    value = seconds / 60 / 60;
    unit = `hour`;
  } else if (seconds > 60) {
    value = seconds / 60;
    unit = `minute`;
  } else {
    value = seconds;
    unit = `second`;
  }
  if (value !== 1) unit += `s`;
  return `${value.toFixed(2)} ${unit}`;
}

export function makePathPatterns(values: string[] | undefined) {
  return values?.flatMap((v) => {
    if (v === "*" || v === "**" || v === "<empty>" || v === "!<empty>") {
      return [v];
    } else {
      return [v, `${v}/**`];
    }
  });
}

export function match(path: string, include?: string[], exclude?: string[]) {
  return (
    (!include || isMatch(path, include, { dot: true })) &&
    (!exclude || !isMatch(path, exclude, { dot: true }))
  );
}

export function endsWith(input: string, patterns: string[]) {
  return patterns.some((pattern) => input.endsWith(pattern));
}

export function createMatchFilter(include?: string[], exclude?: string[]) {
  return (input: string) => match(input, include, exclude);
}

export function checkMatch(subject: string | undefined, patterns: string[]) {
  if (!subject?.length) subject = "<empty>";
  return isMatch(subject, patterns);
}

export function formatDateTime(datetime: string) {
  const date = new Date(datetime);
  const [result] = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .replace("Z", "")
    .replace("T", " ")
    .split(".");
  return result;
}

export function splitLines(input: string, satinize = true) {
  const lines = input.split(/\r?\n/);
  return satinize
    ? input.split(/\r?\n/).reduce((result, value) => {
        value = value.trim();
        if (value.length) result.push(value);

        return result;
      }, [] as string[])
    : lines;
}

export function undefIfEmpty(input: string) {
  return input.length ? input : undefined;
}
