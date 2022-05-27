import { tmpdir } from "os";

const globalData: { configDir?: string; tempDir: string } = {
  tempDir: tmpdir(),
};

export default globalData;
