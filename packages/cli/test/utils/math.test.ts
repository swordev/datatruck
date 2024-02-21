import { Counter, progressPercent } from "../../src/utils/math";
import { describe, expect, test } from "vitest";

describe("progressPercent", () => {
  test("returns cero", () => {
    expect(progressPercent(100, 0)).toBe(0);
  });
  test("returns 1/3", () => {
    expect(progressPercent(3, 1)).toBe(33.33);
  });
});

describe("Counter", () => {
  test("increments", () => {
    const counter = new Counter();
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
  });
  test("resets", () => {
    const counter = new Counter(3);
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
  });
});
