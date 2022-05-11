import { normalize } from "path";

const fromSrc = __filename.endsWith(".ts");

export const rootPath = fromSrc
  ? normalize(`${__dirname}/../../`)
  : normalize(`${__dirname}/../`);
