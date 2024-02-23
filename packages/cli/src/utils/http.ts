import { assertFileChecksum, calcFileHash } from "./crypto";
import { progressPercent } from "./math";
import { BasicProgress } from "./progress";
import {
  ReadStream,
  WriteStream,
  createReadStream,
  createWriteStream,
} from "fs";
import { stat, unlink } from "fs/promises";
import { IncomingMessage, Server, ServerResponse } from "http";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

export function createHref(inUrl: string, query?: Record<string, string>) {
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

export const safeFetch: typeof fetch = async (...args) => {
  const res = await fetch(...args);
  if (res.status !== 200)
    throw new Error(`Fetch request failed: ${res.status} ${res.statusText}`);
  return res;
};

export async function fetchJson<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T | undefined> {
  const res = await safeFetch(url, options);
  const data = await res.text();
  return data.length ? JSON.parse(data) : undefined;
}

export async function post(
  url: string,
  data: string,
  options: Omit<RequestInit, "method" | "body"> = {},
) {
  return await safeFetch(url, { ...options, method: "POST", body: data });
}

export function parseContentLength(value: string | undefined) {
  if (!value || !/^\d+$/.test(value))
    throw new Error(`Invalid 'content-length': ${value}`);
  return Number(value);
}

export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  options: {
    end?: boolean;
    checksum?: boolean;
  } = {},
) {
  let file: ReadStream | undefined;
  try {
    file = createReadStream(path);
    const fileStat = await stat(path);
    res.setHeader("Content-Length", fileStat.size);
    if (options.checksum)
      res.setHeader("x-checksum", await calcFileHash(path, "sha1"));
    file.pipe(res);
    await new Promise<void>((resolve, reject) => {
      file!.on("error", reject);
      req.on("error", reject);
      res.on("error", reject).on("close", resolve);
    });
  } finally {
    file?.close();
    if (options.end) res.end();
  }
}

export async function recvFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  options: {
    end?: boolean;
  } = {},
) {
  let file: WriteStream | undefined;
  try {
    file = createWriteStream(path);
    req.pipe(file);
    await new Promise<void>((resolve, reject) => {
      file!.on("error", reject).on("close", resolve);
      req.on("error", reject);
      res.on("error", reject);
    });
    const checksum = res.getHeader("x-checksum");
    if (typeof checksum === "string")
      await assertFileChecksum(path, checksum, "sha1");
  } finally {
    file?.close();
    if (options.end) res.end();
  }
}

export async function downloadFile(
  url: string,
  output: string,
  options: Omit<RequestInit, "signal"> & {
    timeout?: number;
    onProgress?: (progress: BasicProgress) => void;
  } = {},
) {
  const { timeout, onProgress, ...fetchOptions } = options;
  const file = createWriteStream(output);
  let checksum: string | undefined;
  const length = { total: 0, current: 0 };
  let requestError: Error | undefined;
  try {
    const res = await safeFetch(url, {
      ...fetchOptions,
      signal: AbortSignal.timeout(timeout ?? 3600 * 1000), // 60m
    });
    length.total = parseContentLength(
      res.headers.get("content-length") ?? undefined,
    );
    checksum = res.headers.get("x-checksum") ?? undefined;
    const body = Readable.fromWeb(res.body!);
    const progress =
      onProgress &&
      new Transform({
        transform(chunk, encoding, callback) {
          let error: Error | undefined;
          try {
            length.current += chunk.byteLength;
            onProgress({
              percent: progressPercent(length.total, length.current),
              current: length.current,
              total: length.total,
            });
          } catch (progressError) {
            error = progressError as Error;
          }
          callback(error, chunk);
        },
      });

    if (progress) {
      await pipeline(body, progress, file);
    } else {
      await pipeline(body, file);
    }

    const { size: fileLength } = await stat(output);

    if (length.total !== fileLength)
      throw new Error(
        `Invalid download size: ${length.total} != ${fileLength}`,
      );
  } catch (error) {
    try {
      await unlink(output);
    } catch (_) {}
    throw error;
  }
  if (checksum) await assertFileChecksum(output, checksum, "sha1");
  if (requestError) throw requestError;
  return { bytes: length.total };
}

export async function uploadFile(
  url: string,
  path: string,
  options: Omit<RequestInit, "method" | "body"> & {
    checksum?: boolean;
  } = {},
) {
  const { size } = await stat(path);
  const file = createReadStream(path);
  try {
    const res = await fetch(url, {
      ...options,
      method: "POST",
      duplex: "half",
      headers: {
        ...options.headers,
        "Content-Length": size.toString(),
        ...(options.checksum && {
          "x-checksum": await calcFileHash(path, "sha1"),
        }),
      },
      body: file,
    });

    if (res.status !== 200)
      new Error(`Upload failed: ${res.status} ${res.statusText}`);
  } finally {
    file.close();
  }
}
