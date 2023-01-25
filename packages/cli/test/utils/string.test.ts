import {
  checkMatch,
  formatDateTime,
  formatUri,
  lcfirst,
  makePathPatterns,
  parseStringList,
  render,
  serialize,
  snakeCase,
  ucfirst,
} from "../../src/utils/string";
import { describe, expect, it } from "vitest";

describe("checkMatch", () => {
  const subjects = ["", "a", "b", "c/d"];
  const t = (patterns: string[]) =>
    subjects.filter((s) => checkMatch(s, makePathPatterns(patterns)!)).join();
  it("includes empty", () => {
    expect(t(["*"])).toBe(["", "a", "b"].join());
    expect(t(["**"])).toBe(["", "a", "b", "c/d"].join());
    expect(t(["!a"])).toBe(["", "b", "c/d"].join());
    expect(t(["<empty>"])).toBe([""].join());
  });
  it("does not include empty", () => {
    expect(t(["!<empty>"])).toBe(["a", "b", "c/d"].join());
  });
});

describe("formatDateTime", () => {
  it("returns valid date", () => {
    expect(
      /^\d{4}-\d{2}-\d{2}/.test(formatDateTime("2020-01-01 00:00:00"))
    ).toBe(true);
  });
});

describe("formatUri", () => {
  it("returns local path", () => {
    expect(
      formatUri({
        path: "/var/data",
      })
    ).toBe("/var/data");
  });

  it("returns url", () => {
    expect(
      formatUri({
        protocol: "http",
        host: "localhost",
        path: "/var/data",
      })
    ).toBe("http://localhost/var/data");
  });

  it("returns full url + password", () => {
    expect(
      formatUri({
        protocol: "https",
        username: "guest",
        password: "secret",
        host: "localhost",
        port: 443,
        path: "/path1",
      })
    ).toBe("https://guest:secret@localhost:443/path1");
  });
});

describe("lcfirst", () => {
  it("returns first lower", () => {
    expect(lcfirst("HEllo")).toBe("hEllo");
  });
});

describe("makePathPatterns", () => {
  it("returns two patterns", () => {
    expect(makePathPatterns(["test"])).toEqual(["test", `test/**`]);
  });
});

describe("parseStringList", () => {
  it("returns three elements", () => {
    expect(parseStringList("a,,  b  , c, ")).toEqual(["a", "b", "c"]);
  });
});

describe("render", () => {
  it("returns rendered string", () => {
    expect(
      render("{var1}-{var2}", {
        var1: "hello",
        var2: "world",
      })
    ).toBe("hello-world");
  });

  it("should render repeated var", () => {
    expect(
      render("{var1}-{var1}", {
        var1: "hello",
      })
    ).toBe("hello-hello");
  });

  it("throws error", () => {
    expect(() =>
      render("{var1}-{var2}", {
        var1: "hello",
      })
    ).toThrowError();
  });
  it("escapes special char", () => {
    expect(render("{}var1{/}", {})).toBe("{var1}");
  });
});

describe("serialize", () => {
  it("returns simple message", () => {
    expect(serialize("hello")).toBe("hello");
  });

  it("returns simple message + data", () => {
    expect(serialize("hello", { value: "world" })).toBe(
      `hello (${JSON.stringify({ value: "world" }, null, 2)})`
    );
  });
});

describe("snakeCase", () => {
  it("returns input in snake case format", () => {
    expect(snakeCase("getId")).toBe("get_id");
  });
});

describe("ucfirst", () => {
  it("returns first lower", () => {
    expect(ucfirst("heLlo")).toBe("HeLlo");
  });
});
