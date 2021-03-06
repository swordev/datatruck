import { exec } from "./process-util";
import { normalize } from "path";

export interface ZipDataFilterType {
  recursive?: boolean;
  exclude?: boolean;
  patterns: string[];
}

export type ZipStreamDataType =
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

export interface ZipDataType {
  command?: string;
  path: string;
  filter?: (ZipDataFilterType | string)[];
  output: string;
  deleteOnZip?: boolean;
  includeList?: string;
  excludeList?: string;
  verbose?: boolean;
  onStream?: (data: ZipStreamDataType) => void;
}

export interface UnzipDataType {
  command?: string;
  input: string;
  files?: (ZipDataFilterType | string)[];
  output: string;
  verbose?: boolean;
  onStream?: (data: UnzipStreamDataType) => void;
}

export type UnzipStreamDataType = {
  type: "progress";
  data: {
    progress: number;
    files: number;
    path: string;
  };
};

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

function parseZipStream(
  chunk: string,
  buffer: {
    lastPath?: string;
    currentPaths?: number;
  },
  cb: (data: ZipStreamDataType) => void
) {
  const lines = chunk.trim().split(/\r?\n/g);
  for (const line of lines) {
    let matches: RegExpExecArray | null = null;
    if ((matches = /^(\d+)% (\d+ )?\+/.exec(line))) {
      const path = line.slice(line.indexOf("+") + 1).trim();
      const progress = Number(matches[1]);
      if (!buffer.currentPaths) buffer.currentPaths = 0;
      if (path !== buffer.lastPath) buffer.currentPaths++;
      buffer.lastPath = path;
      cb({
        type: "progress",
        data: { progress, path, files: buffer.currentPaths },
      });
    } else if (line.startsWith("Add new data to archive:")) {
      const [, folders] = /(\d+) folders?/i.exec(line) || [, 0];
      const [, files] = /(\d+) files?/i.exec(line) || [, 0];
      cb({
        type: "summary",
        data: {
          folders: Number(folders),
          files: Number(files),
        },
      });
    }
  }
}

export async function zip(data: ZipDataType) {
  let result = {
    folders: 0,
    files: 0,
  };
  let buffer = {};
  await exec(
    data.command ?? "7z",
    [
      "a",
      "-mmt1",
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
      stderr: {
        toExitCode: true,
      },
      stdout: {
        onData: (chunk) => {
          parseZipStream(chunk, buffer, (stream) => {
            data.onStream?.(stream);
            if (stream.type === "summary") result = stream.data;
          });
        },
      },
    }
  );
  return result;
}

function parseUnzipStream(
  chunk: string,
  cb: (data: UnzipStreamDataType) => void
) {
  const lines = chunk.trim().split(/\r?\n/g);
  for (const line of lines) {
    let matches: RegExpExecArray | null = null;
    if ((matches = /^(\d+)% (\d+) \-/.exec(line))) {
      const progress = Number(matches[1]);
      const files = Number(matches[2]);
      const path = line.slice(line.indexOf("-") + 1).trim();
      cb({
        type: "progress",
        data: { progress, path, files },
      });
    }
  }
}

export async function unzip(data: UnzipDataType) {
  return await exec(
    data.command ?? "7z",
    [
      "x",
      "-mmt1", // https://sourceforge.net/p/sevenzip/bugs/2099/,
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
        ...(data.onStream && {
          onData: (chunk) => {
            if (data.onStream) parseUnzipStream(chunk, data.onStream);
          },
        }),
      },
    }
  );
}
