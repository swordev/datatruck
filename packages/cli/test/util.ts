import type {
  Config,
  RepositoryConfig,
} from "../src/utils/datatruck/config-type";
import { createDatatruckRepositoryServer } from "../src/utils/datatruck/repository-server";
import { writeJSONFile } from "../src/utils/fs";
import { mkTmpDir } from "../src/utils/temp";
import "./toEqualMessage";
import FastGlob from "fast-glob";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { Server } from "http";
import { AddressInfo } from "net";
import { dirname, join } from "path";
import { expect } from "vitest";

export const servers: Set<Server> = new Set();

export type TestRepositoryType =
  | "datatruck"
  | "git"
  | "restic"
  | "datatruck-remote";

export const testRepositoryTypes: TestRepositoryType[] = [
  "datatruck",
  "datatruck-remote",
  "git",
  "restic",
];

export async function makeRepositoryConfig(
  type: TestRepositoryType,
  name: string = type,
) {
  if (type === "datatruck") {
    return makeDatatruckRepositoryConfig(name);
  } else if (type === "datatruck-remote") {
    const server = createDatatruckRepositoryServer({
      backends: [
        {
          name: "main",
          path: await mkTmpDir(type),
          users: [
            {
              name: "user1",
              password: "password1",
            },
          ],
        },
      ],
    });
    servers.add(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", undefined, resolve);
    });
    const { port } = server.address() as AddressInfo;
    return makeDatatruckRepositoryConfig(
      name,
      `http://user1:password1@127.0.0.1:${port}/repo/main`,
    );
  } else if (type === "git") {
    return makeGitRepositoryConfig(name);
  } else if (type === "restic") {
    return makeResticRepositoryConfig(name);
  } else {
    throw new Error(`Invalid type: ${type}`);
  }
}
export async function makeDatatruckRepositoryConfig(
  name: string = "datatruck",
  backend?: string,
) {
  return {
    type: "datatruck",
    name: name,
    config: {
      backend: backend ?? (await mkTmpDir(`test-${name}`)),
    },
  } as RepositoryConfig;
}

export async function makeGitRepositoryConfig(name: string = "git") {
  return {
    type: "git",
    name: name,
    config: {
      repo: await mkTmpDir(`test-${name}`),
    },
  } as RepositoryConfig;
}

export async function makeResticRepositoryConfig(name: string = "restic") {
  const dir = await mkTmpDir(`test-password-${name}`);
  const passwordFile = `${dir}/password.secret`;
  await writeFile(passwordFile, "SECRETVALUE");
  return {
    type: "restic",
    name: name,
    config: {
      repository: {
        backend: "local",
        path: await mkTmpDir(`test-${name}`),
      },
      password: {
        path: passwordFile,
      },
    },
  } as RepositoryConfig;
}

export async function makeConfig(config: Config) {
  const dir = await mkTmpDir("test-config");
  const path = join(dir, "datatruck.json");
  await writeJSONFile(path, config);
  return path;
}

export type FileChangesAction = false | string | Buffer;
export type FileChanges = { [name: string]: FileChanges | FileChangesAction };
export type FileMap = Record<string, Buffer | string | null>;
export type FileChangerResult = {
  path: string;
  update: (changes: FileChanges) => Promise<FileMap>;
};

export async function applyFileChanges(
  dir: string,
  changes: FileChanges,
  files: FileMap,
  parent?: string,
) {
  for (const name in changes) {
    const key = parent ? `${parent}/${name}` : name;
    const change = changes[name];
    const path = join(dir, name);
    if (typeof change === "string" || Buffer.isBuffer(change)) {
      await mkdir(dirname(path), { recursive: true });
      const parentKey = dirname(key);
      if (parentKey !== ".") files[dirname(key)] = null;
      await writeFile(path, change);
      files[key] = change;
    } else if (change === false) {
      await rm(path, { recursive: true });
      delete files[key];
    } else {
      await mkdir(path, { recursive: true });
      files[key] = null;
      await applyFileChanges(path, change, files, key);
    }
  }
}

export function sortObjectKeys<T extends Record<string, any>>(object: T) {
  const keys = Object.keys(object).sort();
  const sorted: T = {} as any;
  for (const name of keys) {
    sorted[name as keyof T] = object[name];
  }
  return sorted;
}

export async function createFileChanger(changes?: FileChanges) {
  const path = await mkTmpDir("test-source");
  const files: FileMap = {};
  const update = async (changes: FileChanges) => {
    await applyFileChanges(path, changes, files);
    return Object.keys(files)
      .sort()
      .reduce((object, file) => {
        object[file] = files[file];
        return object;
      }, {} as FileMap);
  };
  if (changes) await update(changes);
  return {
    path,
    files,
    update,
  };
}

export async function readFiles(dir: string) {
  const files = await FastGlob("**", {
    cwd: dir,
    dot: true,
    onlyFiles: false,
    stats: true,
  });
  const result: FileMap = {};

  for (const file of files) {
    if (file.stats!.isDirectory()) {
      result[file.path] = null;
    } else {
      const path = join(dir, file.path);
      const contents = await readFile(path);
      result[file.path] = file.path.endsWith(".bin")
        ? contents
        : contents.toString();
    }
  }

  return sortObjectKeys(result);
}

export async function expectSameFiles(
  files1: FileMap,
  files2: FileMap,
  errorMessage: string,
) {
  expect(Object.keys(files1).sort().join("\n")).toEqualMessage(
    Object.keys(files2).sort().join("\n"),
    errorMessage,
  );

  for (const name1 in files1) {
    const file1 = files1[name1];
    const file2 = files2[name1];
    if (Buffer.isBuffer(file1) && Buffer.isBuffer(file2)) {
      expect(Buffer.compare(file1, file2)).toEqualMessage(0, errorMessage);
    } else {
      expect(file1).toEqualMessage(file2, errorMessage);
    }
  }
}
