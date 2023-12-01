// @ts-ignore
import json from "./../package.json";

const pkg = json as any as {
  name: string;
  version: string;
  description: string;
};

export { pkg };
