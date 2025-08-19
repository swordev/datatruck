import { logExec } from "../cli";
import { DiskStats } from "../fs";
import { createHref, downloadFile, fetchJson, post, uploadFile } from "../http";
import { BasicProgress } from "../progress";
import { AbstractFs, FsOptions, LocalFs } from "../virtual-fs";
import { headerKey } from "./repository-server";
import { Agent } from "undici";

export class RemoteFs extends AbstractFs {
  protected url: string;
  protected headers: Record<string, string>;
  protected agent: Agent | undefined;
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
    if (options.insecureTls)
      this.agent = new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      });
  }
  isLocal() {
    return false;
  }

  private getCurlArgs(headers: Record<string, string> = {}) {
    const args = Object.entries({ ...headers, ...this.headers }).flatMap(
      ([k, v]) => ["-H", `"${k}: ${v}"`],
    );
    if (this.options.insecureTls) args.push("-k");
    args.push("-v");
    return args;
  }

  protected async fetchJson(name: string, params: any[]) {
    const url = createHref(`${this.url}/${name}`, {
      params: JSON.stringify(params),
    });
    if (this.options.verbose)
      logExec("curl", [...this.getCurlArgs(), `"${url}"`]);
    return await fetchJson(url, {
      headers: this.headers,
      dispatcher: this.agent,
    });
  }

  protected async post(name: string, params: any[], data: string) {
    const url = createHref(`${this.url}/${name}`, {
      params: JSON.stringify(params),
    });
    if (this.options.verbose)
      logExec("curl", [
        ...this.getCurlArgs({ "Content-Type": "application/json" }),
        "--request",
        "POST",
        "--data",
        `"${data}"`,
        `"${url}"`,
      ]);
    return await post(url, data, {
      headers: this.headers,
      dispatcher: this.agent,
    });
  }
  override async existsDir(path: string): Promise<boolean> {
    return await this.fetchJson("existsDir", [path]);
  }
  override async rename(source: string, target: string): Promise<void> {
    return await this.fetchJson("rename", [source, target]);
  }
  override async mkdir(path: string): Promise<void> {
    return await this.fetchJson("mkdir", [path]);
  }
  override async readFile(path: string): Promise<string> {
    return await this.fetchJson("readFile", [path]);
  }
  override async readdir(path: string): Promise<string[]> {
    return await this.fetchJson("readdir", [path]);
  }
  override async readFileIfExists(path: string): Promise<string | undefined> {
    return await this.fetchJson("readFileIfExists", [path]);
  }
  override async ensureEmptyDir(path: string): Promise<void> {
    return await this.fetchJson("readdir", [path]);
  }
  override async writeFile(path: string, contents: string): Promise<void> {
    await this.post("writeFile", [path], contents);
  }
  override async rmAll(path: string): Promise<void> {
    return await this.fetchJson("rmAll", [path]);
  }
  override async fetchDiskStats(path: string): Promise<DiskStats> {
    if (this.options.verbose) logExec("fs.fetchDiskStats", [path]);
    return await this.fetchJson("fetchDiskStats", [path]);
  }
  override async upload(source: string, target: string): Promise<void> {
    if (this.options.verbose) logExec("fs.upload", [source, target]);
    const url = createHref(`${this.url}/upload`, {
      params: JSON.stringify([target]),
    });
    if (this.options.verbose)
      logExec("curl", [
        ...this.getCurlArgs(),
        "-F",
        `data=@${source}`,
        `"${url}"`,
      ]);
    return await uploadFile(url, source, {
      headers: this.headers,
      checksum: true,
      dispatcher: this.agent,
    });
  }
  override async download(
    source: string,
    target: string,
    options: {
      timeout?: number;
      onProgress?: (progress: BasicProgress) => void;
    } = {},
  ): Promise<{ bytes: number }> {
    if (this.options.verbose) logExec("fs.download", [source, target]);
    const url = createHref(`${this.url}/download`, {
      params: JSON.stringify([source]),
    });
    if (this.options.verbose)
      logExec("curl", [...this.getCurlArgs(), `"${url}"`, ">", target]);
    return await downloadFile(url, target, {
      ...options,
      headers: this.headers,
      dispatcher: this.agent,
    });
  }
}

export function isRemoteBackend(backend: string) {
  return backend.startsWith("http:") || backend.startsWith("https:");
}

export function createFs(
  options: { backend: string; insecureTls?: boolean },
  verbose: boolean | undefined,
): AbstractFs {
  return isRemoteBackend(options.backend)
    ? new RemoteFs({
        backend: options.backend,
        insecureTls: options.insecureTls,
        verbose,
      })
    : new LocalFs({ backend: options.backend });
}
