import { formatCronScheduleObject } from "../../src/utils/cron";
import { describe, expect, it } from "vitest";

describe("formatCronScheduleObject", () => {
  const f = formatCronScheduleObject;
  it("returns schedule", () => {
    expect(f({})).toBe("* * * * *");
    expect(f({ hour: 0, minute: 0 })).toBe("0 0 * * *");
    expect(f({ minute: { each: 15 } })).toBe("*/15 * * * *");
  });
});
