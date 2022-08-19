import { AppError } from "../Error/AppError";
import { isMatch } from "micromatch";

export function serialize(message: string, data?: Object) {
  if (data) return `${message} (${JSON.stringify(data, null, 2)})`;
  return message;
}

export function ucfirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function lcfirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function snakeCase(value: string, char = "_") {
  return value.replace(/[A-Z]/g, (letter) => `${char}${letter.toLowerCase()}`);
}

export function render(
  subject: string,
  vars: Record<string, string | undefined>
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

export function parseStringList(value: string, validValues?: string[]) {
  const result =
    value
      ?.split(",")
      .map((v) => v.trim())
      .filter((v) => !!v.length) ?? null;
  if (validValues)
    for (const v of result)
      if (!validValues.includes(v)) throw new AppError(`Invalid value: ${v}`);
  return result;
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
