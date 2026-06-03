export type CronScheduleUnit = number | { each: number };

export type CronScheduleObject = {
  minute?: CronScheduleUnit;
  hour?: CronScheduleUnit;
  day?: CronScheduleUnit;
  month?: CronScheduleUnit;
  weekDay?: CronScheduleUnit;
};

export function resolveCronSchedule(input: CronScheduleObject | string) {
  if (typeof input === "string") return input;
  const keys: (keyof CronScheduleObject)[] = [
    "minute",
    "hour",
    "day",
    "month",
    "weekDay",
  ];
  const result: string[] = [];

  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number") {
      result.push(value.toString());
    } else if (!!value && typeof value === "object") {
      result.push(`*/${value.each}`);
    } else {
      result.push("*");
    }
  }
  return result.join(" ");
}
