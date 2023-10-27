import { getErrorProperties, groupBy, merge } from "../../src/utils/object";
import { describe, expect, it } from "vitest";

describe("getErrorProperties", () => {
  it("returns error properties", () => {
    const props = getErrorProperties(new Error("test"));
    expect(props["message"]).toBe("test");
  });
});

describe("groupBy", () => {
  it("shoulds group by 'a' key", () => {
    expect(groupBy([{ a: 1 }, { a: 1 }, { a: 2 }], "a")).toMatchObject({
      1: [
        {
          a: 1,
        },
        {
          a: 1,
        },
      ],
      2: [
        {
          a: 2,
        },
      ],
    });
  });

  it("shoulds group by 'a' callback key", () => {
    expect(
      groupBy([{ a: 1 }, { a: 1 }, { a: 2 }], (v) => v.a.toString()),
    ).toMatchObject({
      1: [
        {
          a: 1,
        },
        {
          a: 1,
        },
      ],
      2: [
        {
          a: 2,
        },
      ],
    });
  });
});

describe("merge", () => {
  it("shoulds do a deep merge", () => {
    expect(
      merge(
        {
          a: {
            b: {
              c: 1,
            },
          },
        },
        {
          a: {
            b: {
              x: 2,
            },
          },
        },
      ),
    ).toMatchObject({
      a: {
        b: {
          c: 1,
          x: 2,
        },
      },
    });
  });
});
