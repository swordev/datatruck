import {
  downloadFile,
  recvFile,
  sendFile,
  uploadFile,
} from "../../src/utils/http";
import { mkTmpDir } from "../../src/utils/temp";
import { randomBytes } from "crypto";
import { readFile, unlink, writeFile } from "fs/promises";
import { createServer } from "http";
import { AddressInfo } from "net";
import { basename, join } from "path";
import { describe, expect, it } from "vitest";

describe("uploadFile", () => {
  it("uploads random file", async () => {
    const dir = await mkTmpDir("server");
    const server = createServer(async (req, res) => {
      const path = join(dir, req.url!);
      await recvFile(req, res, path);
    });
    try {
      server.listen();
      const { port } = server.address() as AddressInfo;
      for (let x = 1; x <= 1; ++x) {
        const clientPath = join(dir, `${x}-client`);
        const serverPath = join(dir, `${x}-server`);
        const buffer = randomBytes(50 * 1024 * 1024);
        await writeFile(clientPath, buffer);
        await uploadFile(
          `http://127.0.0.1:${port}/${basename(serverPath)}`,
          clientPath,
          { checksum: true },
        );
        expect(buffer.equals(await readFile(serverPath))).toBe(true);
        await unlink(clientPath);
        await unlink(serverPath);
      }
    } finally {
      server.close();
    }
  }, 60_000);
});

describe("downloadFile", () => {
  it("downloads random file", async () => {
    const dir = await mkTmpDir("server");
    const server = createServer(async (req, res) => {
      const path = join(dir, req.url!);
      await sendFile(req, res, path, { checksum: true });
    });
    try {
      server.listen();
      const { port } = server.address() as AddressInfo;
      for (let x = 1; x <= 1; ++x) {
        const clientPath = join(dir, `${x}-client`);
        const serverPath = join(dir, `${x}-server`);
        const buffer = randomBytes(50 * 1024 * 1024);
        await writeFile(serverPath, buffer);
        const { bytes } = await downloadFile(
          `http://127.0.0.1:${port}/${basename(serverPath)}`,
          clientPath,
        );
        expect(bytes).toBe(buffer.byteLength);
        expect(buffer.equals(await readFile(clientPath))).toBe(true);
        await unlink(clientPath);
        await unlink(serverPath);
      }
    } finally {
      server.close();
    }
  }, 60_000);
});
