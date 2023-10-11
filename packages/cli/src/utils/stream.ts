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
