export type CalendarOverride = "holiday" | "makeup_workday";
export type CalendarOverrides = ReadonlyMap<string, CalendarOverride>;

export const SLA_MINUTES = {
  urgent: 30,
  high: 120,
  normal: 480,
  low: 960,
} as const;

const WORK_START_MINUTE = 9 * 60;
const WORK_END_MINUTE = 18 * 60;
const MAX_ITERATIONS = 5 * 366 * 24 * 60;
const SHANGHAI_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type ShanghaiParts = {
  dateKey: string;
  dayOfWeek: number;
  minuteOfDay: number;
};

function getShanghaiParts(timestamp: number): ShanghaiParts {
  const values = Object.fromEntries(
    SHANGHAI_FORMATTER.formatToParts(timestamp).map((part) => [part.type, part.value]),
  );
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    dayOfWeek,
    minuteOfDay: hour * 60 + minute,
  };
}

function isWorkingMinute(timestamp: number, overrides: CalendarOverrides): boolean {
  const parts = getShanghaiParts(timestamp);
  const override = overrides.get(parts.dateKey);
  const workingDay =
    override === "makeup_workday" ||
    (override !== "holiday" && parts.dayOfWeek >= 1 && parts.dayOfWeek <= 5);

  return (
    workingDay && parts.minuteOfDay >= WORK_START_MINUTE && parts.minuteOfDay < WORK_END_MINUTE
  );
}

export function addWorkingMinutes(
  startIso: string,
  minutes: number,
  overrides: CalendarOverrides,
): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) {
    throw new TypeError("startIso must be a valid ISO timestamp");
  }
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError("minutes must be a non-negative integer");
  }
  if (minutes === 0) {
    return start.toISOString();
  }

  let cursor = start.getTime();
  let remaining = minutes;

  for (let iterations = 0; remaining > 0; iterations += 1) {
    if (iterations >= MAX_ITERATIONS) {
      throw new RangeError("working-time calculation exceeded five years");
    }
    if (isWorkingMinute(cursor, overrides)) {
      remaining -= 1;
    }
    cursor += 60_000;
  }

  return new Date(cursor).toISOString();
}
