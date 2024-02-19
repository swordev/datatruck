import { ConfigAction } from "../../actions/ConfigAction";
import { logJson } from "../cli";
import { readRequestData } from "../http";
import { LocalFs } from "../virtual-fs";
import { createReadStream, createWriteStream } from "fs";
import { stat } from "fs/promises";
import { IncomingMessage, createServer } from "http";

type User = {
  enabled?: boolean;
  name: string;
  password: string;
};

export type DatatruckRepositoryServerOptions = {
  enabled?: boolean;
  listen?: {
    port?: number;
    address?: string;
  };
  trustProxy?: true | { remoteAddressHeader: string };
  allowlist?: {
    /**
     * @default true
     */
    enabled?: boolean;
    remoteAddresses?: string[];
  };
  backends?: {
    name: string;
    path: string;
    users?: User[];
  }[];
};

export const headerKey = {
  user: "x-dtt-user",
  password: "x-dtt-password",
};

function parseUrl(
  inUrl: string,
  repositoryPrefix = "repo",
): {
  repository: string | undefined;
  action: string | undefined;
  params: any[];
} {
  const url = new URL(`http://127.0.0.1${inUrl}`);
  const inParams = url.searchParams.get("params");
  const [prefix, repository, action] = url.pathname.slice(1).split("/");
  if (prefix !== repositoryPrefix) {
    return { repository: undefined, action: undefined, params: [] };
  } else if (typeof inParams === "string") {
    const params = JSON.parse(inParams);
    if (!Array.isArray(params)) throw new Error(`Invalid params`);
    return { repository, action, params };
  } else {
    return { repository, action, params: [] };
  }
}

function findRepositoryBackend(
  req: IncomingMessage,
  repository: string,
  options: DatatruckRepositoryServerOptions,
) {
  const list = options.allowlist;
  if (list && (list.enabled ?? true) && list.remoteAddresses) {
    const remoteAddress = getRemoteAddress(req, options);
    if (!remoteAddress || !list.remoteAddresses.includes(remoteAddress))
      return false;
  }

  const name = req.headers[headerKey.user]?.toString().trim();
  const password = req.headers[headerKey.password]?.toString().trim();

  if (!name?.length || !password?.length) return;

  const backend = options.backends?.find((e) => e.name === repository);
  if (!backend) return;

  const user = backend.users?.find(
    (user) => user.name === name && user.password === password,
  );
  if (!user) return;
  if (!(user.enabled ?? true)) return;

  return backend;
}

const getRemoteAddress = (
  req: IncomingMessage,
  options: DatatruckRepositoryServerOptions,
) => {
  return (
    (options.trustProxy
      ? options.trustProxy === true
        ? req.headers["x-real-ip"]?.toString()
        : req.headers[options.trustProxy.remoteAddressHeader]?.toString()
      : undefined) ?? req.socket.remoteAddress
  );
};

export function createDatatruckRepositoryServer(
  inOptions: Omit<DatatruckRepositoryServerOptions, "listen">,
  config: {
    log?: boolean;
    configPath?: string;
  } = {},
) {
  return createServer(async (req, res) => {
    try {
      if (req.url === "/" || req.url === "/favicon.ico") return res.end();
      const { repository, action, params } = parseUrl(req.url!);
      if (!repository || !action) {
        res.statusCode = 404;
        return res.end();
      }

      const fileOptions = config.configPath
        ? (await ConfigAction.findAndParseFile(config.configPath)).server
            ?.repository
        : undefined;

      const options = fileOptions ?? inOptions;
      const backend = findRepositoryBackend(req, repository, options);

      if (!backend) {
        res.statusCode = 401;
        return res.end();
      }

      if (config.log)
        logJson("repository-server", "request", {
          repository,
          url: req.url,
        });

      const fs = new LocalFs({
        backend: backend.path,
      });
      if (action === "comcheck") {
        res.write(JSON.stringify({ success: true }));
      } else if (action === "upload") {
        const [target] = params;
        const path = fs.resolvePath(target);
        const file = createWriteStream(path);
        req.pipe(file);
        await new Promise<void>((resolve, reject) => {
          req.on("error", reject);
          file.on("error", reject);
          file.on("close", resolve);
        });
      } else if (action === "download") {
        const [target] = params;
        const path = fs.resolvePath(target);
        const file = createReadStream(path);
        const fileStat = await stat(path);
        res.setHeader("Content-Length", fileStat.size);
        file.pipe(res);
        await new Promise<void>((resolve, reject) => {
          req.on("error", reject);
          file.on("error", reject);
          res.on("error", reject);
          res.on("close", resolve);
        });
      } else if (action === "writeFile") {
        const data = await readRequestData(req);
        const [target] = params;
        await fs.writeFile(target, data!);
      } else {
        const object = (fs as any)[action]?.bind(fs);
        if (!object) throw new Error(`Invalid action: ${action}`);
        const json = await object(...params);
        if (json !== undefined) res.write(JSON.stringify(json));
      }
      if (config.log)
        logJson("repository-server", "request finished", {
          url: req.url,
        });
      res.end();
    } catch (error) {
      if (config.log) {
        logJson("repository-server", "request failed", {
          url: req.url,
        });
        console.error(error);
      }

      res.statusCode = 500;
      res.statusMessage = (error as Error).message;
      res.end();
    }
  });
}
