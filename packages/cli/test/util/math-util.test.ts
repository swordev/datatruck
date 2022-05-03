import { progressPercent } from "../../src/util/math-util";

describe("progressPercent", () => {
  test("returns cero", () => {
    expect(progressPercent(100, 0)).toBe(0);
  });
  test("returns 1/3", () => {
    expect(progressPercent(3, 1)).toBe(33.33);
  });
});
