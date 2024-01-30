import { AppError } from "./error";
import { isMatch } from "micromatch";

export function snakeCase(value: string, char = "_") {
  return value.replace(/[A-Z]/g, (letter) => `${char}${letter.toLowerCase()}`);
}

export function render(
  subject: string,
  data: Record<string, string | undefined>,
) {
  return subject.replace(/{([\w\./]*)}/g, function (match, name) {
    if (!name.length) {
      return "{";
    } else if (name === "/") {
      return "}";
    }

    let ref: any = data;

    for (const key of name.split(".")) {
      if (!!ref && typeof ref === "object") {
        ref = ref[key];
      } else {
        ref = undefined;
        break;
      }
    }
    if (
      typeof ref !== "string" &&
      typeof ref !== "number" &&
      typeof ref !== "boolean"
    )
      throw new Error(`Variable is not valid: ${name}`, {
        cause: {
          data,
          value: ref,
        },
      });

    return ref.toString();
  });
}

type NoInfer<T> = [T][T extends any ? 0 : never];

export function parseStringList<T>(
  value: string | undefined,
  validValues?: T[],
  defaultsValues?: NoInfer<T>[] | true,
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

export type Uri = {
  protocol?: "http" | "https";
  host?: string;
  username?: string;
  password?: string;
  port?: number;
  path?: string;
};

export function formatUri(input: Uri, hidePassword?: boolean) {
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

export function splitPatterns(
  patterns: string[],
  map?: (pattern: string) => string,
): {
  include: string[] | undefined;
  exclude: string[] | undefined;
} {
  const include: string[] = [];
  const exclude: string[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      const includePattern = pattern.slice(1);
      exclude.push(map ? map(includePattern) : includePattern);
    } else {
      include.push(map ? map(pattern) : pattern);
    }
  }
  return {
    include: include.length ? include : undefined,
    exclude: exclude.length ? exclude : undefined,
  };
}

export function match(path: string, include?: string[], exclude?: string[]) {
  return (
    (!include || isMatch(path, include, { dot: true })) &&
    (!exclude || !isMatch(path, exclude, { dot: true }))
  );
}

export type Filter<V = string> = (subject: V) => boolean;

export function createPatternFilter(patterns: string[] | undefined): Filter;
export function createPatternFilter(
  patterns: { include?: string[]; exclude?: string[] } | undefined,
): Filter;
export function createPatternFilter(
  patterns: string[] | { include?: string[]; exclude?: string[] } | undefined,
): Filter {
  if (patterns === undefined) {
    return () => true;
  } else if (Array.isArray(patterns)) {
    patterns = splitPatterns(patterns);
  }
  const { include, exclude } = patterns;
  return (input: string) => match(input, include, exclude);
}

export function endsWith(input: string, patterns: string[]) {
  return patterns.some((pattern) => input.endsWith(pattern));
}

export function undefIfEmpty(input: string) {
  return input.length ? input : undefined;
}

export function compareJsons(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b);
}
