import { exec } from "./process-util";
import { normalize } from "path";

export interface ZipDataFilterType {
  recursive?: boolean;
  exclude?: boolean;
  patterns: string[];
}

export interface ZipDataType {
  command?: string;
  path: string;
  filter?: (ZipDataFilterType | string)[];
  output: string;
  deleteOnZip?: boolean;
  includeList?: string;
  excludeList?: string;
  verbose?: boolean;
  onProgress?: (data: {
    percent: number;
    total: number;
    current: number;
    path?: string;
    type?: "start" | "end";
  }) => void | Promise<void>;
  onStream?: (data: ZipStream) => void | Promise<void>;
}

export interface UnzipDataType {
  command?: string;
  input: string;
  files?: (ZipDataFilterType | string)[];
  output: string;
  verbose?: boolean;
  onProgress?: (data: {
    percent: number;
    current: number;
    path?: string;
    type?: "start" | "end";
  }) => void | Promise<void>;
  onStream?: (data: UnzipStream) => void | Promise<void>;
}

export function buildArguments(filters: (ZipDataFilterType | string)[]) {
  const args: string[] = [];

  for (const item of filters) {
    let filter: ZipDataFilterType;

    if (typeof item === "string") {
      filter = {
        recursive: false,
        exclude: false,
        patterns: [item],
      };
    } else {
      filter = item;
    }

    args.push(
      ...filter.patterns.map((value) => {
        let option = "-";
        option += filter.exclude ? "x" : "i";
        if (filter.recursive) option += "r";
        option += "!";
        option += normalize(value);
        return option;
      })
    );
  }

  return args;
}

let checkSSEOptionResult: boolean | undefined;

export async function checkSSEOption(command = "7z") {
  const result = await exec(
    command,
    [],
    {},
    {
      stdout: {
        save: true,
      },
    }
  );
  if (typeof checkSSEOptionResult === "boolean") return checkSSEOptionResult;
  return (checkSSEOptionResult = result.stdout.includes(" -sse"));
}

type ListZipStream = {
  Path?: string;
  Folder?: string;
  Size?: string;
  "Packed Size"?: string;
  Modified?: string;
  Created?: string;
  Accessed?: string;
  Attributes?: string;
  Encrypted?: string;
  Comment?: string;
  CRC?: string;
  Method?: string;
  Characteristics?: string;
  "Host OS"?: string;
  Version?: string;
  Volume?: string;
  Offset?: string;
};

type ListZipLineBuffer = {
  started?: boolean;
  opened?: boolean;
  stream?: ListZipStream;
};

const listZipLineEqChar = " = ";

function parseListZipLine(line: string, buffer: ListZipLineBuffer) {
  if (buffer.started) {
    if (line === "") {
      if (buffer.opened) {
        const { stream } = buffer;
        buffer.stream = {};
        buffer.opened = false;
        return stream;
      }
    } else {
      const separator = line.indexOf(listZipLineEqChar);
      const key = line.slice(0, separator);
      const value = line.slice(separator + listZipLineEqChar.length);
      buffer.opened = true;
      buffer.stream![key as keyof ListZipStream] = value;
    }
  } else if (line.startsWith("----------")) {
    buffer.started = true;
    buffer.stream = {};
  }
}

export async function listZip(data: {
  command?: string;
  path: string;
  onStream: (item: ListZipStream) => Promise<void>;
  verbose?: boolean;
}) {
  const buffer: ListZipLineBuffer = {};
  await exec(
    data.command ?? "7z",
    ["l", data.path, "-slt"],
    {},
    {
      log: {
        exec: data.verbose ?? false,
        stderr: data.verbose ?? false,
        stdout: false,
      },
      onExitCodeError: (data, error) => (data.exitCode > 2 ? error : false),
      stdout: {
        parseLines: true,
        onData: async (line) => {
          const stream = parseListZipLine(line, buffer);
          if (stream) {
            await data.onStream?.(stream);
          }
        },
      },
    }
  );
}

export type ZipStream =
  | {
      type: "progress";
      data: {
        progress: number;
        files: number;
        path: string;
      };
    }
  | {
      type: "summary";
      data: {
        folders: number;
        files: number;
      };
    };

function parseZipLine(line: string) {
  let matches: RegExpExecArray | null = null;
  line = line.trim();
  if (!line.length) return;
  if ((matches = /^(\d+)% (\d+ )?\+/.exec(line))) {
    const path = line.slice(line.indexOf("+") + 1).trim();
    const progress = Number(matches[1]);
    const files = matches[2] ? Number(matches[2]) : 1;
    return {
      type: "progress",
      data: { progress, path, files },
    } as ZipStream;
  } else if (line.startsWith("Add new data to archive:")) {
    const [, folders] = /(\d+) folders?/i.exec(line) || [, 0];
    const [, files] = /(\d+) files?/i.exec(line) || [, 0];
    return {
      type: "summary",
      data: {
        folders: Number(folders),
        files: Number(files),
      },
    } as ZipStream;
  }
}

export async function zip(data: ZipDataType) {
  let summary = {
    folders: 0,
    files: 0,
  };
  await data.onProgress?.({
    current: 0,
    percent: 0,
    total: 0,
    type: "start",
  });
  await exec(
    data.command ?? "7z",
    [
      "a",
      // https://sourceforge.net/p/sevenzip/bugs/2099/,
      // https://github.com/mcmilk/7-Zip/commit/87ba6f01ba3c5b2ce3186bddfe3d7d880639193c#diff-779d6b1bfa6196b288478f78ca96c4d4c6d7ac6cf8be15a28a20dabc9137ca36L515
      ...((await checkSSEOption(data.command)) ? [] : ["-mmt1"]),
      "-bsp1",
      ...(data.deleteOnZip ? ["-sdel"] : []),
      normalize(data.output),
      ...buildArguments(data.filter ?? []),
      ...(data.includeList ? [`@${normalize(data.includeList)}`] : []),
      ...(data.excludeList ? [`-x@${normalize(data.excludeList)}`] : []),
    ],
    {
      cwd: data.path,
    },
    {
      log: data.verbose ?? false,
      onExitCodeError: (data, error) => (data.exitCode > 2 ? error : false),
      stdout: {
        onData: async (lines) => {
          for (const line of lines.split(/\r?\n/)) {
            const stream = parseZipLine(line);
            if (stream) {
              if (stream.type === "summary") summary = stream.data;
              if (stream.type === "progress") {
                const current = Math.max(0, stream.data.files - 1);
                await data.onProgress?.({
                  total: summary.files,
                  current,
                  path: stream.data.path,
                  percent: stream.data.progress,
                });
              }
              await data.onStream?.(stream);
            }
          }
        },
      },
    }
  );
  await data.onProgress?.({
    total: summary.files,
    current: summary.files,
    percent: 100,
    type: "end",
  });
  return summary;
}

export type UnzipStream = {
  type: "progress";
  data: {
    percent: number;
    files: number;
    path: string;
  };
};
function parseUnzipLine(line: string) {
  let matches: RegExpExecArray | null = null;
  if ((matches = /^\s*(\d+)% (\d+) \-/.exec(line))) {
    const progress = Number(matches[1]);
    const files = Number(matches[2]);
    const path = line.slice(line.indexOf("-") + 1).trim();
    return {
      type: "progress",
      data: { percent: progress, path, files },
    } as UnzipStream;
  }
}

export async function unzip(data: UnzipDataType) {
  let summary = {
    files: 0,
  };
  await data.onProgress?.({
    current: summary.files,
    percent: 0,
    type: "start",
  });
  const result = await exec(
    data.command ?? "7z",
    [
      "x",
      "-bsp1",
      normalize(data.input),
      ...buildArguments(data.files ?? []),
      `-o${normalize(data.output)}`,
      "-r",
    ],
    {},
    {
      log: data.verbose ?? false,
      stderr: { toExitCode: true },
      stdout: {
        ...((data.onStream || data.onProgress) && {
          parseLines: true,
          onData: async (line) => {
            const stream = parseUnzipLine(line);
            if (stream) {
              if (stream.type === "progress") {
                const current = Math.max(0, stream.data.files - 1);
                summary.files = stream.data.files;
                await data.onProgress?.({
                  current,
                  percent: stream.data.percent,
                  path: stream.data.path,
                });
              }
              await data.onStream?.(stream);
            }
          },
        }),
      },
    }
  );
  await data.onProgress?.({
    current: summary.files,
    percent: 100,
    type: "end",
  });
  return {
    ...result,
    ...summary,
  };
}
