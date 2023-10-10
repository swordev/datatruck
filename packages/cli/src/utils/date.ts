import { formatSeconds } from "./string";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);
dayjs.extend(advancedFormat);

export type FilterByLastOptionsType = {
  last?: number;
  lastMinutely?: number;
  lastHourly?: number;
  lastDaily?: number;
  lastWeekly?: number;
  lastMonthly?: number;
  lastYearly?: number;
};

export function filterByLast<TItem extends { date: string }>(
  items: TItem[],
  options: FilterByLastOptionsType,
  reasons?: Record<number, string[]>,
) {
  const filters: {
    [name in keyof typeof options]: {
      handler: (date: dayjs.Dayjs, index: number) => string;
      value: number | undefined;
      last?: string;
    };
  } = {
    last: { handler: (_, i) => i.toString(), value: options.last },
    lastMinutely: {
      handler: (d) => d.format("YYYYMMDDHHmm"),
      value: options.lastMinutely,
    },
    lastHourly: {
      handler: (d) => d.format("YYYYMMDDHH"),
      value: options.lastHourly,
    },
    lastDaily: {
      handler: (d) => d.format("YYYYMMDD"),
      value: options.lastDaily,
    },
    lastMonthly: {
      handler: (d) => d.format("YYYYMM"),
      value: options.lastMonthly,
    },
    lastWeekly: {
      handler: (d) => d.format("YYYYWW"),
      value: options.lastWeekly,
    },
    lastYearly: { handler: (d) => d.format("YYYY"), value: options.lastYearly },
  };
  let someFilter = false;
  for (const key in filters) {
    const object = filters[key as keyof typeof options];
    if (object?.value) {
      someFilter = true;
    }
  }
  if (!someFilter) return items;
  const validItems = items
    .slice(0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((item, index) => {
      const date = dayjs(item.date);
      const itemIndex = items.indexOf(item);
      let success = false;
      for (const key in filters) {
        const object = filters[key as keyof typeof options];
        if (object?.value) {
          const value = object.handler(date, index);
          if (value != object.last) {
            success = true;
            if (reasons) {
              if (!reasons[itemIndex]) reasons[itemIndex] = [];
              if (!reasons[itemIndex].includes(key))
                reasons[itemIndex].push(key);
            }
            object.last = value;
            object.value--;
          }
        }
      }
      return success;
    });
  return items.filter((item) => validItems.includes(item));
}

export type Timer = {
  reset: (min?: number) => boolean;
  check: (min: number) => boolean;
  elapsed: () => number;
  stop: () => void;
};

export function createTimer() {
  let startTime = Date.now();
  let endTime: number | undefined;
  const timer: Timer = {
    elapsed: () => (endTime || Date.now()) - startTime,
    check: (ms: number) => timer.elapsed() > ms,
    stop: () => (endTime = Date.now()),
    reset: (min?: number) => {
      if (typeof min === "number" && !timer.check(min)) return false;
      startTime = Date.now();
      endTime = undefined;
      return true;
    },
  };
  return timer;
}
