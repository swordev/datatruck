import { readRequestData } from "../http";
import { LocalFs } from "../virtual-fs";
import { createReadStream, createWriteStream } from "fs";
import { stat } from "fs/promises";
import { IncomingMessage, createServer } from "http";

type User = {
  name: string;
  password: string;
};
export type DatatruckServerOptions = {
  path?: string;
  log?: boolean;
  listen?: {
    port?: number;
    address?: string;
  };
  users?: User[];
};

function parseUrl(inUrl: string): { action: string; params: any[] } {
  const url = new URL(`http://127.0.0.1${inUrl}`);
  const inParams = url.searchParams.get("params");
  const action = url.pathname.slice(1);
  if (typeof inParams === "string") {
    const params = JSON.parse(inParams);
    if (!Array.isArray(params)) throw new Error(`Invalid params`);
    return { action, params };
  } else {
    return { action, params: [] };
  }
}

export const headerKey = {
  user: "x-dtt-user",
  password: "x-dtt-password",
};

function validateRequest(req: IncomingMessage, users: User[]) {
  const name = req.headers[headerKey.user];
  const password = req.headers[headerKey.password];
  return users.some(
    (user) =>
      user.name.length &&
      user.password.length &&
      user.name === name &&
      user.password === password,
  );
}

export function createDatatruckServer(options: DatatruckServerOptions) {
  const log = options.log ?? true;
  return createServer(async (req, res) => {
    try {
      if (req.url === "/" || req.url === "/favicon.ico") {
        return res.end();
      } else if (!validateRequest(req, options.users || [])) {
        res.statusCode = 401;
        return res.end();
      }
      if (log) console.info(`> ${req.url}`);
      const fs = new LocalFs({
        backend: options.path ?? ".",
      });
      const { action, params } = parseUrl(req.url!);
      if (action === "upload") {
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
      res.end();
      if (log) console.info(`<${action}`);
    } catch (error) {
      if (log) console.error(`<${req.url}`, error);
      res.statusCode = 500;
    }
  });
}
