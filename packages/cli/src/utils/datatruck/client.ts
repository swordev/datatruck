import { downloadFile, fetchJson, post, uploadFile } from "../http";
import { AbstractFs, FsOptions, LocalFs } from "../virtual-fs";
import { headerKey } from "./server";

export class RemoteFs extends AbstractFs {
  protected url: string;
  protected headers: Record<string, string>;
  constructor(readonly options: FsOptions) {
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
  async upload(source: string, target: string) {
    await uploadFile(`${this.url}/upload`, source, {
      headers: this.headers,
      query: {
        params: JSON.stringify([target]),
      },
    });
  }
  async download(source: string, target: string, timeout = 100_000) {
    await downloadFile(`${this.url}/download`, target, {
      timeout,
      headers: this.headers,
      query: {
        params: JSON.stringify([source]),
      },
    });
  }
}

export function isRemoteBackend(backend: string) {
  return backend.startsWith("http:") || backend.startsWith("https:");
}

export function createFs(backend: string): AbstractFs {
  return isRemoteBackend(backend)
    ? new RemoteFs({ backend })
    : new LocalFs({ backend });
}
