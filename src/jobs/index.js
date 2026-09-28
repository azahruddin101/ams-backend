// SCHEDULER SWITCHED OFF (see startJobs at the bottom). Uncomment together with it.
// import cron from "node-cron";
import { Company, AttendanceRecord, Subscription } from "../models/index.js";
import { COMPANY_STATUS, SUBSCRIPTION_STATUS } from "../constants/index.js";
import { logger } from "../config/logger.js";
import { dateKeyInTz, addDaysToKey, eachDateKey } from "../utils/time.js";
import { recomputeCompanyDay } from "../services/attendance/recompute.js";
import { notify } from "../services/notification.service.js";
import { User } from "../models/index.js";

/**
 * Every job takes `{ companyId }` to work on one company instead of all of them, and returns a summary of what it did.
 * The schedule (startJobs) calls them with no options; the dashboard button calls the same functions by hand.
 */
const activeCompanies = (companyId) =>
  Company.find({ status: { $in: [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.TRIAL] }, deletedAt: null, ...(companyId && { _id: companyId }) }).lean();

/**
 * Finalises yesterday for every tenant: auto-marks absent/holiday/week-off/leave and flags INCOMPLETE.
 * `from` (a date key) also processes the days before yesterday, for catching up after the schedule was off.
 */
export async function dailyAttendanceProcessing(now = new Date(), { companyId, from } = {}) {
  const summary = { companies: 0, days: 0, employeeDays: 0, from: null, to: null };
  for (const c of await activeCompanies(companyId)) {
    const yesterday = addDaysToKey(dateKeyInTz(now, c.timezone), -1);
    const dates = from && from < yesterday ? eachDateKey(from, yesterday) : [yesterday];
    for (const date of dates) { // oldest first: each day's late count builds on the days before it
      const n = await recomputeCompanyDay(c._id, date, { now });
      await AttendanceRecord.updateMany({ companyId: c._id, date, finalizedAt: null }, { finalizedAt: now });
      logger.info({ msg: "daily attendance processed", companyId: String(c._id), date, employees: n });
      summary.employeeDays += n;
    }
    summary.companies++;
    summary.days = Math.max(summary.days, dates.length);
    summary.from = dates[0];
    summary.to = yesterday;
  }
  return summary;
}

export async function subscriptionChecks(now = new Date(), { companyId } = {}) {
  const expired = await Subscription.find({ status: { $in: [SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE] }, currentPeriodEnd: { $lt: now }, ...(companyId && { companyId }) }).lean();
  for (const s of expired) {
    await Subscription.updateOne({ _id: s._id }, { status: SUBSCRIPTION_STATUS.EXPIRED });
    const admins = await User.find({ companyId: s.companyId, role: "COMPANY" }).select("_id").lean();
    for (const a of admins) await notify({ companyId: s.companyId, userId: a._id, title: "Subscription expired", body: "Renew to continue using the service." });
  }
  return { expired: expired.length };
}

/** On the 1st of the month (company time) closes the previous month. `force` closes it on any day, for a run by hand. */
export async function monthlyFinalization(now = new Date(), { companyId, force = false } = {}) {
  const summary = { companies: 0, records: 0, month: null };
  for (const c of await activeCompanies(companyId)) {
    const today = dateKeyInTz(now, c.timezone);
    if (!force && today.slice(8) !== "01") continue;
    const prev = addDaysToKey(`${today.slice(0, 7)}-01`, -1); // last day of the previous month
    const res = await AttendanceRecord.updateMany({ companyId: c._id, date: { $gte: `${prev.slice(0, 7)}-01`, $lte: prev }, finalizedAt: null }, { finalizedAt: now });
    summary.companies++;
    summary.records += res.modifiedCount ?? 0;
    summary.month = prev.slice(0, 7);
  }
  return summary;
}

/**
 * SCHEDULER SWITCHED OFF. The jobs above are run by hand from the dashboard ("Run jobs" → POST /jobs/run).
 *
 * An in-process timer cannot work on Vercel: there is no server that stays running between requests, so nothing would
 * ever fire. To schedule the jobs again:
 *   • on a normal server: uncomment this block, the `node-cron` import at the top, and the two lines in server.js;
 *   • on Vercel: leave this off and add a Vercel Cron entry that calls POST /jobs/run instead.
 */
export const SCHEDULER_ENABLED = false;

// export function startJobs() {
//   const safe = (name, fn) => async () => {
//     try { await fn(); } catch (err) { logger.error({ msg: `job ${name} failed`, err: err.message }); }
//   };
//   // Hourly so every timezone gets processed shortly after its own midnight; operations are idempotent.
//   cron.schedule("15 * * * *", safe("dailyAttendanceProcessing", dailyAttendanceProcessing));
//   cron.schedule("0 2 * * *", safe("subscriptionChecks", subscriptionChecks));
//   cron.schedule("45 3 * * *", safe("monthlyFinalization", monthlyFinalization));
//   logger.info({ msg: "background jobs scheduled" });
// }
