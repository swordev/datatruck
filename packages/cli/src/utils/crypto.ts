import { createHash } from "crypto";
import { createReadStream } from "fs";

export function calcFileHash(path: string, algorithm: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash(algorithm);
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export async function assertFileChecksum(
  path: string,
  checksum: string,
  algorithm: string,
) {
  const fileChecksum = await calcFileHash(path, algorithm);
  if (fileChecksum !== checksum)
    throw new Error(`Invalid checksum file: ${checksum} != ${fileChecksum}`);
}
