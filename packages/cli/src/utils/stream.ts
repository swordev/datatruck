import { Writable } from "stream";

export type Streams = {
  stdout: Writable;
  stderr: Writable;
};

export function createStreams(options: Partial<Streams> = {}): Streams {
  return {
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
  };
}


export async function waitForClose(
  stream:
    | {
        on(event: "close", cb: (...args: any[]) => any): any;
      }
    | {
        on(event: "close", cb: (...args: any[]) => any): any;
        on(event: "error", cb: (...args: any[]) => any): any;
      },
) {
  return new Promise<void>((resolve, reject) => {
    stream.on("close", resolve);
    stream.on("error" as any, reject);
  });
}