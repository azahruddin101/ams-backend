import { eachDateKey } from "./time.js";

/**
 * A leave request covers either every day from `fromDate` to `toDate`, or — when the employee picked separate days —
 * only the days listed in `dates` (fromDate/toDate are then just the first and last of them).
 */
export const leaveDates = (req) => (req.dates?.length ? [...req.dates] : eachDateKey(req.fromDate, req.toDate));

/** Mongo filter: requests that cover this day. */
export const coversDate = (dateKey) => ({
  fromDate: { $lte: dateKey },
  toDate: { $gte: dateKey },
  $or: [{ dates: { $exists: false } }, { dates: { $size: 0 } }, { dates: dateKey }],
});
