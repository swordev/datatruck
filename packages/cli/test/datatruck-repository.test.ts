import {
  DatatruckRepositoryServerOptions,
  createDatatruckRepositoryServer,
  headerKey,
} from "../src/utils/datatruck/repository-server";
import { mkTmpDir } from "../src/utils/temp";
import { Server } from "http";
import { AddressInfo } from "net";
import { afterEach } from "node:test";
import { describe, expect, it } from "vitest";

const servers = new Set<Server>();
async function create(
  options: Omit<DatatruckRepositoryServerOptions, "listen">,
): Promise<[string, Server]> {
  const server = createDatatruckRepositoryServer(options);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", undefined, resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  return [url, server];
}

function expectFetch(url: string, options?: RequestInit) {
  return {
    toBe: async (status: number, data?: string) => {
      const res = await fetch(url, options);
      expect(res.status).toEqual(status);
      if (typeof data === "string") expect(await res.text()).toEqual(data);
    },
  };
}

describe("createDatatruckRepositoryServer", () => {
  afterEach(() => {
    for (const server of servers) server.close();
    servers.clear();
  });
  it("responds with success", async () => {
    const [url] = await create({
      backends: [{ name: "main", path: await mkTmpDir("test-server") }],
    });
    await expectFetch(url).toBe(200);
    await expectFetch(`${url}/favicon.ico`).toBe(200);
  });

  it("responds with not found error", async () => {
    const [url] = await create({
      backends: [{ name: "main", path: await mkTmpDir("test-server") }],
    });
    await expectFetch(`${url}/test`).toBe(404);
    await expectFetch(`${url}/repo/main`).toBe(404);
  });
  it("responds with auth error", async () => {
    const [url] = await create({
      backends: [
        {
          name: "main",
          path: await mkTmpDir("test-server"),
          users: [{ name: "user", password: "pass" }],
        },
      ],
    });

    await expectFetch(`${url}/repo/main/comcheck`, {
      headers: {
        [headerKey.user]: "",
        [headerKey.password]: "",
      },
    }).toBe(401);

    await expectFetch(`${url}/repo/main/comcheck`, {
      headers: {
        [headerKey.user]: "user",
        [headerKey.password]: "",
      },
    }).toBe(401);

    await expectFetch(`${url}/repo/main/comcheck`, {
      headers: {
        [headerKey.user]: "user",
        [headerKey.password]: "pas",
      },
    }).toBe(401);
  });

  it("responds with empty-auth error", async () => {
    const [url1] = await create({
      backends: [
        {
          name: "main",
          path: await mkTmpDir("test-server"),
          users: [{ name: "user", password: "" }],
        },
      ],
    });

    await expectFetch(`${url1}/repo/main/comcheck`, {
      headers: {
        [headerKey.user]: "user",
        [headerKey.password]: "",
      },
    }).toBe(401);

    const [url2] = await create({
      backends: [
        {
          name: "main",
          path: await mkTmpDir("test-server"),
          users: [{ name: "", password: "pass" }],
        },
      ],
    });

    await expectFetch(`${url2}/repo/main/comcheck`, {
      headers: {
        [headerKey.user]: "",
        [headerKey.password]: "pass",
      },
    }).toBe(401);
  });
  it("responds with disabled-auth error", async () => {
    const [url] = await create({
      backends: [
        {
          name: "main",
          path: await mkTmpDir("test-server"),
          users: [{ enabled: false, name: "user", password: "pass" }],
        },
      ],
    });

    await expectFetch(`${url}/repo/main/comcheck`, {
      headers: {
        [headerKey.user]: "user",
        [headerKey.password]: "pass",
      },
    }).toBe(401);
  });

  it("auths with the correct backend", async () => {
    const [url] = await create({
      backends: [
        {
          name: "repo1",
          path: await mkTmpDir("test-server"),
          users: [{ name: "user1", password: "pass" }],
        },
        {
          name: "repo2",
          path: await mkTmpDir("test-server"),
          users: [{ name: "user2", password: "pass" }],
        },
      ],
    });
    await expectFetch(`${url}/repo/repo1/comcheck`, {
      headers: {
        [headerKey.user]: "user2",
        [headerKey.password]: "pass",
      },
    }).toBe(401);
    await expectFetch(`${url}/repo/repo2/comcheck`, {
      headers: {
        [headerKey.user]: "user2",
        [headerKey.password]: "pass",
      },
    }).toBe(200, JSON.stringify({ success: true }));
  });
  it("responds with auth success", async () => {
    const [url] = await create({
      backends: [
        {
          name: "main",
          path: await mkTmpDir("test-server"),
          users: [{ name: "user", password: "pass" }],
        },
      ],
    });
    await expectFetch(`${url}/repo/main/comcheck`, {
      headers: {
        [headerKey.user]: "user",
        [headerKey.password]: "pass",
      },
    }).toBe(200, JSON.stringify({ success: true }));
  });
});
