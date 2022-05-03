import { ConfigType } from "../src/Config/Config";
import {
  RepositoryConfigType,
  RepositoryConfigTypeType,
} from "../src/Config/RepositoryConfig";
import { mkTmpDir, writeJSONFile } from "../src/util/fs-util";
import { writeFile } from "fs/promises";
import { join } from "path";

export async function makeRepositoryConfig(
  type: RepositoryConfigTypeType,
  name = type
) {
  if (type === "local") {
    return makeLocalRepositoryConfig(name);
  } else if (type === "git") {
    return makeGitRepositoryConfig(name);
  } else if (type === "restic") {
    return makeResticRepositoryConfig(name);
  } else {
    throw new Error(`Invalid type: ${type}`);
  }
}
export async function makeLocalRepositoryConfig(name: string = "local") {
  return {
    type: "local",
    name: name,
    config: {
      outPath: await mkTmpDir(`test-${name}`),
    },
  } as RepositoryConfigType;
}

export async function makeGitRepositoryConfig(name: string = "git") {
  return {
    type: "git",
    name: name,
    config: {
      repo: await mkTmpDir(`test-${name}`),
    },
  } as RepositoryConfigType;
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
      passwordFile: passwordFile,
    },
  } as RepositoryConfigType;
}

export async function makeConfig(config: ConfigType) {
  const dir = await mkTmpDir("test-config");
  const path = join(dir, "datatruck.json");
  await writeJSONFile(path, config);
  return path;
}

export async function makeJsonSource(json: unknown) {
  const dir = await mkTmpDir("test-source");
  await writeJSONFile(`${dir}/file1.json`, json);
  return dir;
}

export async function alterJsonSource(sourceDir: string, json: unknown) {
  await writeJSONFile(`${sourceDir}/file1.json`, json);
}
