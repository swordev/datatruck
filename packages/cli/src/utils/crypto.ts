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
