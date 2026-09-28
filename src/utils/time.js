import { TIME } from "../constants/index.js";

const fmtCache = new Map();
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return fmtCache.get(tz);
}

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in the given timezone. */
export function zonedParts(date, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

export const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the instant in tz. */
export function dateKeyInTz(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight for the instant in tz. */
export function minutesOfDayInTz(date, tz) {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
}

export const parseHHmm = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export function addDaysToKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Sunday .. 6 = Saturday for a "YYYY-MM-DD" key (calendar-only, tz-free). */
export function weekdayOfKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Local wall time (dateKey + minutes-of-day, may exceed 1440) in tz → UTC Date. */
export function zonedToUtc(dateKey, minutes, tz) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let ts = guess;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(ts), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = asUtc - guess;
    if (diff === 0) break;
    ts -= diff;
  }
  return new Date(ts);
}

export const diffMinutes = (a, b) => Math.round((new Date(b) - new Date(a)) / TIME.MS_PER_MINUTE);

export function eachDateKey(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDaysToKey(k, 1)) out.push(k);
  return out;
}

export const monthRange = (year, month) => {
  const from = `${year}-${pad(month)}-01`;
  const to = addDaysToKey(`${month === 12 ? year + 1 : year}-${pad(month === 12 ? 1 : month + 1)}-01`, -1);
  return { from, to };
};
