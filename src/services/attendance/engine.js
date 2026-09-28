import { ATTENDANCE_STATUS, EVENT_TYPES, IN_EVENT_TYPES, OUT_EVENT_TYPES, TIMING_MODES, LATE_PENALTIES, PENALTY_PERIODS, PENALTY_REPEAT, PENALTY_REASONS } from "../../constants/index.js";
import { addDaysToKey, diffMinutes, minutesOfDayInTz, dateKeyInTz, parseHHmm, weekdayOfKey, zonedToUtc } from "../../utils/time.js";

const CHECKOUT_BUFFER_MINUTES = 180;

export const isOvernightShift = (shift) => Boolean(shift) && parseHHmm(shift.endTime) <= parseHHmm(shift.startTime);

/** Shift-anchored attendance date for an instant (handles overnight shifts). */
export function resolveAttendanceDate(instant, shift, tz) {
  const key = dateKeyInTz(instant, tz);
  if (isOvernightShift(shift)) {
    const m = minutesOfDayInTz(instant, tz);
    if (m <= parseHHmm(shift.endTime) + CHECKOUT_BUFFER_MINUTES) return addDaysToKey(key, -1);
  }
  return key;
}

/** UTC instants of scheduled shift start/end for an attendance date. */
export function shiftWindow(dateKey, shift, policy, tz) {
  const startStr = shift?.startTime ?? policy?.expectedCheckInTime;
  const endStr = shift?.endTime ?? policy?.expectedCheckOutTime;
  if (!startStr || !endStr) return null;
  const s = parseHHmm(startStr);
  const e = parseHHmm(endStr);
  const overnight = e <= s;
  return { start: zonedToUtc(dateKey, s, tz), end: zonedToUtc(dateKey, e + (overnight ? 1440 : 0), tz), overnight };
}

/** Pair IN/OUT events into sessions; also derive explicit and gap break minutes. */
export function buildSessions(events, now) {
  const sessions = [];
  let open = null;
  let breakStart = null;
  let explicitBreak = 0;
  for (const ev of events) {
    if (IN_EVENT_TYPES.includes(ev.type)) {
      if (!open) open = ev.timestamp;
    } else if (OUT_EVENT_TYPES.includes(ev.type)) {
      if (open) {
        sessions.push({ checkIn: open, checkOut: ev.timestamp, durationMinutes: Math.max(0, diffMinutes(open, ev.timestamp)) });
        open = null;
      }
    } else if (ev.type === EVENT_TYPES.BREAK_START) {
      if (!breakStart && open) breakStart = ev.timestamp;
    } else if (ev.type === EVENT_TYPES.BREAK_END) {
      if (breakStart) {
        explicitBreak += Math.max(0, diffMinutes(breakStart, ev.timestamp));
        breakStart = null;
      }
    }
  }
  const isOpen = Boolean(open);
  if (open) {
    sessions.push({ checkIn: open, checkOut: null, durationMinutes: now ? Math.max(0, diffMinutes(open, now)) : 0 });
  }
  if (breakStart && now) explicitBreak += Math.max(0, diffMinutes(breakStart, now));
  let gapBreak = 0;
  for (let i = 1; i < sessions.length; i++) {
    if (sessions[i - 1].checkOut) gapBreak += Math.max(0, diffMinutes(sessions[i - 1].checkOut, sessions[i].checkIn));
  }
  return { sessions, isOpen, explicitBreak, gapBreak };
}

const emptyFlags = { isLate: false, isHalfDay: false, isAbsent: false, isOvertime: false, isIncomplete: false, isOpen: false };
const zeroMetrics = { sessions: [], totalWorkingMinutes: 0, breakMinutes: 0, overtimeMinutes: 0, lateMinutes: 0, earlyCheckoutMinutes: 0 };

/**
 * Pure daily attendance calculation.
 * @param {object} p
 * @param {string} p.dateKey
 * @param {object[]} p.events        non-void events for the date, sorted by timestamp asc
 * @param {object|null} p.shift
 * @param {object} p.policy
 * @param {string} p.tz
 * @param {"WORKDAY"|"HOLIDAY"|"WEEK_OFF"} p.dayType
 * @param {{isHalfDay:boolean}|null} p.leave   approved leave covering the date
 * @param {Date} p.now
 * @returns {object|null} record fields, or null when nothing should be recorded yet
 */
export function calculateDay({ dateKey, events, shift, policy, tz, dayType = "WORKDAY", leave = null, now = new Date() }) {
  const window = shiftWindow(dateKey, shift, policy, tz);
  const dayFinished = window ? now >= new Date(window.end.getTime() + CHECKOUT_BUFFER_MINUTES * 60000) : dateKey < dateKeyInTz(now, tz);

  const { sessions, isOpen, explicitBreak, gapBreak } = buildSessions(events, dayFinished ? null : now);

  // Nothing usable: no events, or only stray ones (e.g. a check-out whose check-in was voided).
  if (sessions.length === 0) {
    const base = { ...zeroMetrics, ...emptyFlags, shiftId: shift?._id };
    if (leave && !leave.isHalfDay) return { ...base, status: ATTENDANCE_STATUS.ON_LEAVE };
    if (dayType === "HOLIDAY") return { ...base, status: ATTENDANCE_STATUS.HOLIDAY };
    if (dayType === "WEEK_OFF") return { ...base, status: ATTENDANCE_STATUS.WEEK_OFF };
    if (!dayFinished) return null;
    return { ...base, status: ATTENDANCE_STATUS.ABSENT, isAbsent: true };
  }

  const closedMinutes = sessions.reduce((s, x) => s + x.durationMinutes, 0);
  const totalWorkingMinutes = Math.max(0, closedMinutes - explicitBreak);
  const breakMinutes = explicitBreak + gapBreak;
  const firstCheckIn = sessions[0].checkIn;
  const closedSessions = sessions.filter((s) => s.checkOut);
  const lastCheckOut = closedSessions.length ? closedSessions[closedSessions.length - 1].checkOut : null;

  // Flexible timing has no fixed in/out time: nobody is late or early, only the hours worked count.
  // No time bound goes further: no required hours either, so showing up at all is a present day.
  const unbound = policy.timingMode === TIMING_MODES.NO_TIME_BOUND;
  const fixedTiming = !unbound && policy.timingMode !== TIMING_MODES.FLEXIBLE;

  // Lateness
  const graceMinutes = shift?.gracePeriod ?? policy.gracePeriod ?? 0;
  let lateMinutes = 0;
  let isLate = false;
  if (fixedTiming && window && dayType === "WORKDAY") {
    const raw = Math.max(0, diffMinutes(window.start, firstCheckIn));
    if (raw > graceMinutes + (policy.lateAfterMinutes ?? 0)) {
      isLate = true;
      lateMinutes = raw;
    }
  }

  // Early checkout (only meaningful once the day is closed out)
  let earlyCheckoutMinutes = 0;
  if (fixedTiming && window && lastCheckOut && !isOpen) {
    const early = diffMinutes(lastCheckOut, window.end);
    if (early > (policy.earlyCheckoutThreshold ?? 0)) earlyCheckoutMinutes = early;
  }

  // Overtime
  const otEnabled = !unbound && policy.overtimeEnabled && (shift ? shift.allowOvertime !== false : true);
  const otAfter = shift?.overtimeAfterMinutes ?? policy.overtimeAfterMinutes ?? shift?.requiredWorkingMinutes;
  const overtimeMinutes = otEnabled && otAfter != null && !isOpen ? Math.max(0, totalWorkingMinutes - otAfter) : 0;

  const flags = { ...emptyFlags, isLate, isOvertime: overtimeMinutes > 0, isOpen };
  const shortfall = leave?.isHalfDay ? 0.5 : 1; // half-day leave halves the expected work
  const minWork = (policy.minimumWorkingMinutes ?? 0) * shortfall;
  const halfWork = (policy.halfDayWorkingMinutes ?? 0) * shortfall;

  let status;
  if (unbound) {
    // People in the field often never check out: that is not an incomplete day, and the record is closed once the day is over.
    flags.isOpen = isOpen && !dayFinished;
    status = ATTENDANCE_STATUS.PRESENT;
  } else if (isOpen && dayFinished) {
    flags.isIncomplete = true;
    status = ATTENDANCE_STATUS.INCOMPLETE;
  } else if (isOpen) {
    status = isLate ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT;
  } else if (dayType === "WORKDAY" && (totalWorkingMinutes < minWork || (isLate && lateMinutes > policy.absentAfterMinutes))) {
    flags.isAbsent = true;
    status = ATTENDANCE_STATUS.ABSENT;
  } else if (dayType === "WORKDAY" && (totalWorkingMinutes < halfWork || (isLate && lateMinutes > policy.halfDayAfterMinutes))) {
    flags.isHalfDay = true;
    status = ATTENDANCE_STATUS.HALF_DAY;
  } else {
    status = isLate ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT;
  }

  return {
    shiftId: shift?._id,
    sessions,
    firstCheckIn,
    lastCheckOut,
    totalWorkingMinutes,
    breakMinutes,
    overtimeMinutes,
    lateMinutes,
    earlyCheckoutMinutes,
    status,
    ...flags,
  };
}

/* ---------- repeated lateness ---------- */
export const hasLatePenaltyRules = (policy) => Boolean(policy?.lateCountEnabled || policy?.lateStreakEnabled);

/** First day of the period the late-count rule counts in (weeks start on Monday). */
export function penaltyPeriodStart(dateKey, period) {
  if (period === PENALTY_PERIODS.WEEK) return addDaysToKey(dateKey, -((weekdayOfKey(dateKey) + 6) % 7));
  return `${dateKey.slice(0, 7)}-01`;
}

const reaches = (n, threshold, repeat) => threshold > 0 && (repeat === PENALTY_REPEAT.EVERY_NTH ? n > 0 && n % threshold === 0 : n >= threshold);

/**
 * Pure. Downgrades a late day to half day / absent when the company's repeated-lateness rules are met.
 * @param {object} day        result of calculateDay
 * @param {object} policy
 * @param {{lateCount:number, lateStreak:number}} history  late days in the period / in a row, both INCLUDING this day
 */
export function applyLatePenalty(day, policy, { lateCount = 0, lateStreak = 0 } = {}) {
  const clean = { ...day, penaltyReason: null };
  if (!day.isLate || day.isOpen || ![ATTENDANCE_STATUS.LATE, ATTENDANCE_STATUS.HALF_DAY].includes(day.status)) return clean;

  const hits = [];
  if (policy.lateCountEnabled && reaches(lateCount, policy.lateCountThreshold, policy.latePenaltyRepeat)) hits.push({ reason: PENALTY_REASONS.LATE_COUNT, penalty: policy.lateCountPenalty });
  if (policy.lateStreakEnabled && reaches(lateStreak, policy.lateStreakThreshold, policy.latePenaltyRepeat)) hits.push({ reason: PENALTY_REASONS.LATE_STREAK, penalty: policy.lateStreakPenalty });
  const hit = hits.find((h) => h.penalty === LATE_PENALTIES.ABSENT) ?? hits[0]; // the harsher rule wins
  if (!hit) return clean;

  if (hit.penalty === LATE_PENALTIES.ABSENT) return { ...day, status: ATTENDANCE_STATUS.ABSENT, isAbsent: true, isHalfDay: false, penaltyReason: hit.reason };
  if (day.status === ATTENDANCE_STATUS.HALF_DAY) return clean; // already a half day on its own merits
  return { ...day, status: ATTENDANCE_STATUS.HALF_DAY, isHalfDay: true, penaltyReason: hit.reason };
}
