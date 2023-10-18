import { formatBytes, parseSize } from "../../src/utils/bytes";
import { describe, expect, it } from "vitest";

describe("formatBytes", () => {
  it("returns size", () => {
    expect(formatBytes(1)).toBe("1B");
    expect(formatBytes(1024)).toBe("1.0KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0MB");
  });
  it("throws error", () => {
    expect(() => formatBytes(-1)).toThrowError();
  });
});

describe("parseSize", () => {
  it("returns bytes", () => {
    expect(parseSize("1024B")).toBe(1024);
    expect(parseSize("1024 B")).toBe(1024);
    expect(parseSize("7658mb")).toBe(8029995008);
    expect(parseSize("4.5GB")).toBe(4831838208);
  });
  it("throws error", () => {
    expect(() => parseSize("")).toThrowError();
    expect(() => parseSize("-5MB")).toThrowError();
    expect(() => parseSize("1mb ")).toThrowError();
    expect(() => parseSize("1 bytes")).toThrowError();
  });
});
