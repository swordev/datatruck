import { logExec } from "../cli";
import { DiskStats } from "../fs";
import { downloadFile, fetchJson, post, uploadFile } from "../http";
import { BasicProgress } from "../progress";
import { AbstractFs, FsOptions, LocalFs } from "../virtual-fs";
import { headerKey } from "./repository-server";

export class RemoteFs extends AbstractFs {
  protected url: string;
  protected headers: Record<string, string>;
  constructor(readonly options: FsOptions & { verbose?: boolean }) {
    super(options);
    const url = new URL(options.backend);
    this.headers = {
      [headerKey.user]: url.username,
      [headerKey.password]: url.password,
    };
    url.username = "";
    url.password = "";
    this.url = url.href;
    if (this.url.endsWith("/")) this.url = this.url.slice(0, -1);
  }
  isLocal() {
    return false;
  }
  protected async fetchJson(name: string, params: any[]) {
    return await fetchJson(`${this.url}/${name}`, {
      headers: this.headers,
      query: {
        params: JSON.stringify(params),
      },
    });
  }
  protected async post(name: string, params: any[], data: string) {
    return await post(`${this.url}/${name}`, data, {
      headers: this.headers,
      query: {
        params: JSON.stringify(params),
      },
    });
  }
  async existsDir(path: string) {
    return await this.fetchJson("existsDir", [path]);
  }
  async rename(source: string, target: string) {
    return await this.fetchJson("rename", [source, target]);
  }
  async mkdir(path: string) {
    return await this.fetchJson("mkdir", [path]);
  }
  async readFile(path: string) {
    return await this.fetchJson("readFile", [path]);
  }
  async readdir(path: string) {
    return await this.fetchJson("readdir", [path]);
  }
  async readFileIfExists(path: string): Promise<string | undefined> {
    return await this.fetchJson("readFileIfExists", [path]);
  }
  async ensureEmptyDir(path: string): Promise<void> {
    return await this.fetchJson("readdir", [path]);
  }
  async writeFile(path: string, contents: string) {
    await this.post("writeFile", [path], contents);
  }
  async rmAll(path: string) {
    await this.fetchJson("rmAll", [path]);
  }
  async fetchDiskStats(path: string): Promise<DiskStats> {
    if (this.options.verbose) logExec("fs.fetchDiskStats", [path]);
    return await this.fetchJson("fetchDiskStats", [path]);
  }
  async upload(source: string, target: string) {
    if (this.options.verbose) logExec("fs.upload", [source, target]);
    await uploadFile(`${this.url}/upload`, source, {
      headers: this.headers,
      query: {
        params: JSON.stringify([target]),
      },
    });
  }
  async download(
    source: string,
    target: string,
    options: {
      timeout?: number;
      onProgress?: (progress: BasicProgress) => void;
    } = {},
  ) {
    if (this.options.verbose) logExec("fs.download", [source, target]);
    return await downloadFile(`${this.url}/download`, target, {
      ...options,
      headers: this.headers,
      query: { params: JSON.stringify([source]) },
    });
  }
}

export function isRemoteBackend(backend: string) {
  return backend.startsWith("http:") || backend.startsWith("https:");
}

export function createFs(
  backend: string,
  verbose: boolean | undefined,
): AbstractFs {
  return isRemoteBackend(backend)
    ? new RemoteFs({ backend, verbose })
    : new LocalFs({ backend });
}
