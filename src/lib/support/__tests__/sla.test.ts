import { describe, expect, it } from "vitest";

import { addWorkingMinutes, SLA_MINUTES } from "../sla";

const holidays = new Map<string, "holiday" | "makeup_workday">([
  ["2026-10-01", "holiday"],
  ["2026-10-10", "makeup_workday"],
]);

describe("addWorkingMinutes", () => {
  it("rolls after-hours work to the next weekday", () => {
    expect(addWorkingMinutes("2026-06-12T10:30:00.000Z", 60, holidays)).toBe(
      "2026-06-15T02:00:00.000Z",
    );
  });

  it("skips a configured holiday", () => {
    expect(addWorkingMinutes("2026-09-30T09:00:00.000Z", 120, holidays)).toBe(
      "2026-10-02T02:00:00.000Z",
    );
  });

  it("counts a weekend make-up workday", () => {
    expect(addWorkingMinutes("2026-10-09T09:00:00.000Z", 120, holidays)).toBe(
      "2026-10-10T02:00:00.000Z",
    );
  });

  it("preserves the instant when no work is requested", () => {
    expect(addWorkingMinutes("2026-06-13T04:34:56.000Z", 0, holidays)).toBe(
      "2026-06-13T04:34:56.000Z",
    );
  });

  it("rejects negative or non-integer minute counts", () => {
    expect(() => addWorkingMinutes("2026-06-12T10:30:00.000Z", -1, holidays)).toThrow(
      "minutes must be a non-negative integer",
    );
    expect(() => addWorkingMinutes("2026-06-12T10:30:00.000Z", 1.5, holidays)).toThrow(
      "minutes must be a non-negative integer",
    );
  });

  it("rejects invalid timestamps", () => {
    expect(() => addWorkingMinutes("not-a-date", 30, holidays)).toThrow(
      "startIso must be a valid ISO timestamp",
    );
  });
});

describe("SLA_MINUTES", () => {
  it("defines the agreed priority targets", () => {
    expect(SLA_MINUTES).toEqual({
      urgent: 30,
      high: 120,
      normal: 480,
      low: 960,
    });
  });
});
