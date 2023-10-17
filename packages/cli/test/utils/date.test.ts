import { filterByLast } from "../../src/utils/date";
import { describe, expect, it } from "vitest";

const makeDates = (dates: string[]) => dates.map((d) => ({ date: d }));
describe("filterByLast", () => {
  it("returns references", () => {
    const object1 = {
      date: "2020-01-01 00:00:00",
    };
    const object2 = {
      date: "2020-01-02 00:00:00",
    };
    const result = filterByLast([object1, object2], {});
    expect(object1 === result[0].item).toBeTruthy();
    expect(object2 === result[1].item).toBeTruthy();
    expect(result[0].reasons).toEqual(["no-filter"]);
    expect(result[1].reasons).toEqual(["no-filter"]);
  });

  it("returns all", () => {
    expect(
      filterByLast(
        makeDates([
          "2020-01-01 00:00:00",
          "2020-01-04 00:00:00",
          "2020-01-02 00:00:00",
          "2020-01-03 00:00:00",
        ]),
        {},
      ),
    ).toEqual([
      { item: { date: "2020-01-01 00:00:00" }, reasons: ["no-filter"] },
      { item: { date: "2020-01-04 00:00:00" }, reasons: ["no-filter"] },
      { item: { date: "2020-01-02 00:00:00" }, reasons: ["no-filter"] },
      { item: { date: "2020-01-03 00:00:00" }, reasons: ["no-filter"] },
    ]);
  });

  it("returns last 2", () => {
    expect(
      filterByLast(
        makeDates([
          "2020-01-01 00:00:00",
          "2020-01-04 00:00:00",
          "2020-01-02 00:00:00",
          "2020-01-03 00:00:00",
        ]),
        {
          last: 2,
        },
      ),
    ).toEqual([
      { item: { date: "2020-01-04 00:00:00" }, reasons: ["last"] },
      { item: { date: "2020-01-03 00:00:00" }, reasons: ["last"] },
    ]);
  });

  it("returns last daily 3", () => {
    expect(
      filterByLast(
        makeDates([
          "2020-01-01 00:00:00",
          "2020-01-04 00:00:00",
          "2020-01-02 00:00:00",
          "2020-01-03 00:00:00",
        ]),
        {
          lastDaily: 3,
        },
      ),
    ).toEqual([
      { item: { date: "2020-01-04 00:00:00" }, reasons: ["lastDaily"] },
      { item: { date: "2020-01-02 00:00:00" }, reasons: ["lastDaily"] },
      { item: { date: "2020-01-03 00:00:00" }, reasons: ["lastDaily"] },
    ]);
  });

  it("returns last monthly 2", () => {
    expect(
      filterByLast(
        makeDates([
          "2020-01-01 00:00:00",
          "2020-04-03 00:00:00",
          "2020-02-04 00:00:00",
          "2020-03-30 22:00:00",
          "2020-03-30 20:00:00",
        ]),
        {
          lastMonthly: 2,
        },
      ),
    ).toEqual([
      { item: { date: "2020-04-03 00:00:00" }, reasons: ["lastMonthly"] },
      { item: { date: "2020-03-30 22:00:00" }, reasons: ["lastMonthly"] },
    ]);
  });
});
