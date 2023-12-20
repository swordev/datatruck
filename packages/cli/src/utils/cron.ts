export type CronScheduleUnit = number | { each: number };

export type CronScheduleObject = {
  minute?: CronScheduleUnit;
  hour?: CronScheduleUnit;
  day?: CronScheduleUnit;
  month?: CronScheduleUnit;
  weekDay?: CronScheduleUnit;
};

export function formatCronScheduleObject(object: CronScheduleObject) {
  const keys: (keyof CronScheduleObject)[] = [
    "minute",
    "hour",
    "day",
    "month",
    "weekDay",
  ];
  const result: string[] = [];

  for (const key of keys) {
    const value = object[key];
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
