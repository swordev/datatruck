import { progressPercent } from "./math";
import { BasicProgress, ProgressStats } from "./progress";
import { createReadStream, createWriteStream } from "fs";
import { stat, unlink } from "fs/promises";
import {
  ClientRequest,
  IncomingMessage,
  Server,
  request as requestHttp,
} from "http";
import { RequestOptions, request as requestHttps } from "https";

const request = (
  url: string,
  options: RequestOptions,
  callback?: (res: IncomingMessage) => void,
): ClientRequest => {
  return url.startsWith("https://")
    ? requestHttps(url, options, callback)
    : requestHttp(url, options, callback);
};

function href(inUrl: string, query?: Record<string, string>) {
  const url = new URL(inUrl);
  for (const key in query || {}) url.searchParams.set(key, query![key]);
  return url.href;
}

export async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

export function readRequestData(req: IncomingMessage) {
  let data: string | undefined;
  return new Promise<string | undefined>((resolve, reject) => {
    req
      .on("error", reject)
      .on("data", (chunk) => {
        if (data === undefined) data = "";
        data += chunk;
      })
      .on("close", async () => {
        resolve(data);
      });
  });
}

export async function fetchJson<T = any>(
  url: string,
  options: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
) {
  return new Promise<T>((resolve, reject) => {
    let data: string | undefined;
    request(
      href(url, options.query),
      {
        method: "GET",
        headers: options.headers,
      },
      (res) => {
        if (res.statusCode !== 200)
          return reject(
            new Error(`GET failed: ${res.statusCode} ${res.statusMessage}`),
          );
        res
          .on("data", (chunk) => {
            if (data === undefined) data = "";
            data += chunk;
          })
          .on("error", reject)
          .on("close", () => {
            if (data === undefined) {
              resolve(undefined as T);
            } else {
              try {
                resolve(JSON.parse(data));
              } catch (error) {
                reject(error);
              }
            }
          });
      },
    )
      .on("error", reject)
      .end();
  });
}

export async function post(
  url: string,
  data: string,
  options: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
) {
  await new Promise<void>((resolve, reject) => {
    const req = request(
      href(url, options.query),
      { method: "POST", headers: options.headers },
      (res) => {
        res.on("error", reject);
        if (res.statusCode !== 200) {
          reject(
            new Error(`Post failed: ${res.statusCode} ${res.statusMessage}`),
          );
        } else {
          resolve();
        }
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export async function downloadFile(
  url: string,
  output: string,
  options: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    timeout?: number;
    onProgress?: (progress: BasicProgress) => void;
  } = {},
) {
  const timeout = options.timeout ?? 3600 * 1000; // 60m
  const file = createWriteStream(output);
  await new Promise<void>((resolve, reject) => {
    const req = request(
      href(url, options.query),
      {
        headers: options.headers,
      },
      (res) => {
        const contentLength = res.headers["content-length"] ?? "";

        if (!/^\d+$/.test(contentLength))
          return reject(
            new Error(`Invalid 'content-length': ${contentLength}`),
          );

        const total = Number(contentLength);
        let current = 0;

        if (res.statusCode === 200) {
          if (options.onProgress) {
            res.on("data", (chunk: Buffer) => {
              current += chunk.byteLength;
              options.onProgress!({
                percent: progressPercent(total, current),
                current,
                total,
              });
            });
          }
          res
            .on("error", async (error) => {
              try {
                file.destroy();
              } catch (_) {}
              try {
                await unlink(output);
              } catch (_) {}
              reject(error);
            })
            .pipe(file);
          file.on("finish", () => {
            file.close((error) => {
              error ? reject(error) : resolve();
            });
          });
        } else {
          reject(
            new Error(
              `Download failed: ${res.statusCode} ${res.statusMessage}`,
            ),
          );
        }
      },
    ).on("error", async (error) => {
      try {
        await unlink(output);
      } catch (_) {}
      reject(error);
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout / 1000}s`));
    });

    req.end();
  });
}

export async function uploadFile(
  url: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
) {
  const { size } = await stat(path);
  const readStream = createReadStream(path);

  await new Promise<void>((resolve, reject) => {
    const req = request(
      href(url, options.query),
      {
        method: "POST",
        headers: {
          ...options.headers,
          "Content-length": size,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(
            new Error(`Upload failed: ${res.statusCode} ${res.statusMessage}`),
          );
        } else {
          resolve();
        }
      },
    ).on("error", reject);

    readStream.on("error", reject).pipe(req);
  });
}
