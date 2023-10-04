import { closeServer } from "../src/utils/http";
import { servers } from "./util";
import { beforeEach } from "vitest";

beforeEach(async () => {
  return async () => {
    await Promise.all([...servers].map((s) => closeServer(s)));
    servers.clear();
  };
});
