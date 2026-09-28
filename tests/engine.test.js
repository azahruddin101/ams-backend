import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateDay, resolveAttendanceDate, applyLatePenalty, penaltyPeriodStart } from "../src/services/attendance/engine.js";
import { distanceMeters } from "../src/utils/geo.js";
import { zonedToUtc } from "../src/utils/time.js";

const TZ = "Asia/Kolkata";
const day = "2026-03-10";
const at = (h, m, d = day) => zonedToUtc(d, h * 60 + m, TZ);
const ev = (type, h, m, d) => ({ type, timestamp: at(h, m, d) });
const IN = (h, m, d) => ev("CHECK_IN", h, m, d);
const OUT = (h, m, d) => ev("CHECK_OUT", h, m, d);

const shift = { startTime: "09:00", endTime: "18:00", gracePeriod: 10, requiredWorkingMinutes: 480, allowOvertime: true, overtimeAfterMinutes: 480 };
const policy = {
  gracePeriod: 10, lateAfterMinutes: 0, halfDayAfterMinutes: 120, absentAfterMinutes: 240,
  minimumWorkingMinutes: 240, halfDayWorkingMinutes: 300, earlyCheckoutThreshold: 15,
  overtimeEnabled: true, overtimeAfterMinutes: 480,
};
const later = at(23, 0);
const calc = (events, extra = {}) => calculateDay({ dateKey: day, events, shift, policy, tz: TZ, now: later, ...extra });

test("working hours: multiple sessions 09:02-13:05 + 14:00-18:10 = 493", () => {
  const r = calc([IN(9, 2), OUT(13, 5), IN(14, 0), OUT(18, 10)]);
  assert.equal(r.totalWorkingMinutes, 493);
  assert.equal(r.sessions[0].durationMinutes, 243);
  assert.equal(r.sessions[1].durationMinutes, 250);
  assert.equal(r.breakMinutes, 55);
  assert.equal(r.overtimeMinutes, 13);
  assert.equal(r.isOvertime, true);
  assert.equal(r.status, "PRESENT");
});

test("late: within grace is on time, beyond grace is late", () => {
  assert.equal(calc([IN(9, 10), OUT(18, 0)]).isLate, false);
  const r = calc([IN(9, 20), OUT(18, 30)]);
  assert.equal(r.isLate, true);
  assert.equal(r.lateMinutes, 20);
  assert.equal(r.status, "LATE");
});

test("half-day: very late arrival or short working time", () => {
  const lateArrival = calc([IN(11, 30), OUT(19, 0)]);
  assert.equal(lateArrival.isHalfDay, true);
  assert.equal(lateArrival.status, "HALF_DAY");
  const short = calc([IN(9, 0), OUT(13, 30)]); // 270 min
  assert.equal(short.status, "HALF_DAY");
});

test("absent: working below minimum, or no events after day ends", () => {
  assert.equal(calc([IN(9, 0), OUT(10, 0)]).status, "ABSENT");
  const none = calc([]);
  assert.equal(none.status, "ABSENT");
  assert.equal(none.isAbsent, true);
});

test("no events before the day is over records nothing", () => {
  assert.equal(calc([], { now: at(8, 0) }), null);
});

test("open session: live while day in progress, INCOMPLETE after day ends", () => {
  const live = calc([IN(9, 0)], { now: at(12, 0) });
  assert.equal(live.isOpen, true);
  assert.equal(live.totalWorkingMinutes, 180);
  assert.equal(calc([IN(9, 0)]).status, "INCOMPLETE");
});

test("holiday / week-off / approved leave without events", () => {
  assert.equal(calc([], { dayType: "HOLIDAY" }).status, "HOLIDAY");
  assert.equal(calc([], { dayType: "WEEK_OFF" }).status, "WEEK_OFF");
  assert.equal(calc([], { leave: { isHalfDay: false } }).status, "ON_LEAVE");
});

test("half-day leave halves the working requirement", () => {
  const r = calc([IN(9, 0), OUT(12, 30)], { leave: { isHalfDay: true } }); // 210 >= 150
  assert.equal(r.status, "PRESENT");
});

test("overnight shift: dates anchor to shift start day and hours span midnight", () => {
  const night = { startTime: "21:00", endTime: "06:00", gracePeriod: 10, requiredWorkingMinutes: 480, overtimeAfterMinutes: 600 };
  assert.equal(resolveAttendanceDate(at(21, 5, "2026-03-10"), night, TZ), "2026-03-10");
  assert.equal(resolveAttendanceDate(at(6, 2, "2026-03-11"), night, TZ), "2026-03-10");
  const r = calculateDay({
    dateKey: "2026-03-10", shift: night, policy, tz: TZ, now: at(12, 0, "2026-03-11"),
    events: [IN(21, 5, "2026-03-10"), OUT(6, 0, "2026-03-11")],
  });
  assert.equal(r.totalWorkingMinutes, 535);
  assert.equal(r.isLate, false);
  assert.equal(r.status, "PRESENT");
});

test("a late day carries no money fields: salary is worked out in the salary report, never stored on the day", () => {
  const r = calc([IN(9, 25), OUT(18, 30)]);
  assert.equal(r.isLate, true);
  assert.equal(r.lateMinutes, 25);
  for (const k of ["deductionAmount", "deductionReason"]) assert.equal(k in r, false, `${k} should not exist`);
});

test("flexible timing: no lateness or early checkout, only the hours worked decide the day", () => {
  const flexible = { ...policy, timingMode: "FLEXIBLE", halfDayWorkingMinutes: 480 };
  const full = calc([IN(12, 0), OUT(20, 5)], { policy: flexible });
  assert.equal(full.isLate, false);
  assert.equal(full.lateMinutes, 0);
  assert.equal(full.status, "PRESENT");
  const split = calc([IN(7, 0), OUT(11, 0), IN(15, 0), OUT(19, 10)], { policy: flexible }); // several in/outs add up
  assert.equal(split.totalWorkingMinutes, 490);
  assert.equal(split.status, "PRESENT");
  const short = calc([IN(9, 0), OUT(16, 0)], { policy: flexible });
  assert.equal(short.earlyCheckoutMinutes, 0);
  assert.equal(short.status, "HALF_DAY");
  assert.equal(calc([IN(12, 0), OUT(20, 5)]).status, "HALF_DAY"); // the same day under fixed timing: 3 hours late
});

test("no time bound: marking attendance at any time is a present day, with no hours to complete", () => {
  const free = { ...policy, timingMode: "NO_TIME_BOUND" };
  const brief = calc([IN(15, 30), OUT(16, 0)], { policy: free }); // 30 minutes, mid-afternoon
  assert.deepEqual([brief.status, brief.isLate, brief.isHalfDay, brief.isAbsent, brief.earlyCheckoutMinutes, brief.overtimeMinutes], ["PRESENT", false, false, false, 0, 0]);
  assert.equal(brief.totalWorkingMinutes, 30); // time is still recorded, just not judged
  const long = calc([IN(7, 0), OUT(21, 0)], { policy: free });
  assert.deepEqual([long.status, long.isOvertime], ["PRESENT", false]);
  const neverOut = calc([IN(10, 0)], { policy: free }); // checked in from the field, never checked out
  assert.deepEqual([neverOut.status, neverOut.isIncomplete, neverOut.isOpen], ["PRESENT", false, false]);
  assert.equal(calc([IN(10, 0)], { policy: free, now: at(12, 0) }).isOpen, true); // still the same day
  assert.equal(calc([], { policy: free }).status, "ABSENT"); // no attendance at all is still absent
  assert.equal(calc([], { policy: free, dayType: "WEEK_OFF" }).status, "WEEK_OFF");
  assert.equal(applyLatePenalty(brief, { lateCountEnabled: true, lateCountThreshold: 1 }, { lateCount: 5 }).status, "PRESENT");
});

test("late penalties: count and streak rules, repeat modes, harsher rule wins", () => {
  const late = calc([IN(9, 25), OUT(18, 30)]);
  const rules = { lateCountEnabled: true, lateCountThreshold: 3, lateCountPenalty: "HALF_DAY", latePenaltyRepeat: "NTH_ONWARDS" };
  assert.equal(applyLatePenalty(late, rules, { lateCount: 2 }).status, "LATE");
  const third = applyLatePenalty(late, rules, { lateCount: 3 });
  assert.deepEqual([third.status, third.isHalfDay, third.penaltyReason, third.isLate], ["HALF_DAY", true, "LATE_COUNT", true]);
  assert.equal(applyLatePenalty(late, rules, { lateCount: 4 }).status, "HALF_DAY");

  const every = { ...rules, latePenaltyRepeat: "EVERY_NTH" }; // 3 lates = 1 half day
  assert.deepEqual([3, 4, 5, 6].map((n) => applyLatePenalty(late, every, { lateCount: n }).status), ["HALF_DAY", "LATE", "LATE", "HALF_DAY"]);

  const streak = { lateStreakEnabled: true, lateStreakThreshold: 2, lateStreakPenalty: "ABSENT" };
  assert.equal(applyLatePenalty(late, streak, { lateStreak: 1 }).status, "LATE");
  const out = applyLatePenalty(late, { ...rules, ...streak }, { lateCount: 3, lateStreak: 2 });
  assert.deepEqual([out.status, out.isAbsent, out.isHalfDay, out.penaltyReason], ["ABSENT", true, false, "LATE_STREAK"]);

  // never touches a day that is on time, still open, or has no rules
  assert.equal(applyLatePenalty(calc([IN(9, 0), OUT(18, 0)]), rules, { lateCount: 9 }).status, "PRESENT");
  assert.equal(applyLatePenalty(calc([IN(9, 25)], { now: at(12, 0) }), rules, { lateCount: 9 }).penaltyReason, null);
  assert.equal(applyLatePenalty(late, {}, { lateCount: 9, lateStreak: 9 }).status, "LATE");
});

test("late penalties: weekly counts start on Monday, monthly on the 1st", () => {
  assert.equal(penaltyPeriodStart("2026-03-04", "WEEK"), "2026-03-02"); // Wednesday → Monday
  assert.equal(penaltyPeriodStart("2026-03-08", "WEEK"), "2026-03-02"); // Sunday belongs to the week that started Monday
  assert.equal(penaltyPeriodStart("2026-03-02", "WEEK"), "2026-03-02");
  assert.equal(penaltyPeriodStart("2026-03-19", "MONTH"), "2026-03-01");
});

test("geofencing distance is computed server-side (haversine)", () => {
  const d = distanceMeters(12.9716, 77.5946, 12.9716, 77.5946 + 0.001);
  assert.ok(d > 100 && d < 120, `distance ${d}`);
  assert.equal(Math.round(distanceMeters(0, 0, 0, 0)), 0);
});
