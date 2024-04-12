import { fetchData } from "./fs";

export type MongoUriObject<Resolved = false> = {
  host: string;
  username?: string;
  password?: [Resolved] extends [true] ? string : string | { path: string };
  port?: number;
  database: string;
};

export function toMongoUri(object: MongoUriObject<true>) {
  const url = new URL(`mongodb://${object.host}`);
  if (typeof object.username === "string") url.username = object.username;
  if (typeof object.password === "string") url.password = object.password;
  if (typeof object.port === "number") url.port = object.port.toString();
  url.pathname = `/${object.database}`;
  return url.href;
}

export async function resolveMongoUri(
  input: string | MongoUriObject,
): Promise<MongoUriObject<true>> {
  let object: MongoUriObject;
  if (typeof input === "string") {
    const url = new URL(input);
    object = {
      host: url.hostname,
      password: url.password,
      port: url.port ? Number(url.port) : undefined,
      username: url.username,
      database: url.pathname.slice(1),
    };
  } else {
    object = input;
  }
  return {
    ...object,
    password:
      object.password !== undefined
        ? (await fetchData(object.password, (p) => p.path)) ?? ""
        : "",
  };
}
