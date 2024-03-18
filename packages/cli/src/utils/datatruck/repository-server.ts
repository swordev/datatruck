import { ConfigAction } from "../../actions/ConfigAction";
import { logJson } from "../cli";
import { readRequestData, recvFile, sendFile } from "../http";
import { Counter } from "../math";
import { LocalFs } from "../virtual-fs";
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
  keepAliveTimeout?: number;
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
  const counter = new Counter();
  const server = createServer(async (req, res) => {
    const url = req.url || "";
    if (url === "/" || url === "/favicon.ico") return res.end();
    const id = counter.next();
    let requestError: Error | undefined;
    let responseError: Error | undefined;
    req.on("error", (error) => (requestError = error));
    res.on("error", (error) => (responseError = error));
    try {
      const { repository, action, params } = parseUrl(url);
      if (!repository || !action) return res.writeHead(404);

      const fileOptions = config.configPath
        ? (await ConfigAction.findAndParseFile(config.configPath)).server
            ?.repository
        : undefined;

      const options = fileOptions ?? inOptions;
      const backend = findRepositoryBackend(req, repository, options);

      if (!backend) return res.writeHead(401);

      if (config.log)
        logJson("repository-server", "request", { id, repository, url });

      const fs = new LocalFs({ backend: backend.path });

      if (action === "comcheck") {
        res.write(JSON.stringify({ success: true }));
      } else if (action === "upload") {
        const [target] = params;
        const path = fs.resolvePath(target);
        await recvFile(req, res, path);
      } else if (action === "download") {
        const [target] = params;
        const path = fs.resolvePath(target);
        await sendFile(req, res, path);
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
      if (config.log) logJson("repository-server", "request finished", { id });
    } catch (error) {
      if (config.log) {
        logJson("repository-server", "request failed", { id });
        console.error(error);
      }
      if (!res.writableEnded && !res.headersSent)
        res.writeHead(500, (error as Error).message);
    } finally {
      if (requestError) {
        logJson("repository-server", "request error", { id });
        console.error(requestError);
      }
      if (responseError) {
        logJson("repository-server", "response error", { id });
        console.error(responseError);
      }

      if (!res.writableEnded) res.end();
    }
  });
  if (typeof inOptions.keepAliveTimeout === "number")
    server.keepAliveTimeout = inOptions.keepAliveTimeout;
  return server;
}
