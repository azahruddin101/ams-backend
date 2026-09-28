import cron from "node-cron";
import { Company, AttendanceRecord, Subscription } from "../models/index.js";
import { COMPANY_STATUS, SUBSCRIPTION_STATUS } from "../constants/index.js";
import { logger } from "../config/logger.js";
import { dateKeyInTz, addDaysToKey } from "../utils/time.js";
import { recomputeCompanyDay } from "../services/attendance/recompute.js";
import { notify } from "../services/notification.service.js";
import { User } from "../models/index.js";

const activeCompanies = () => Company.find({ status: { $in: [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.TRIAL] }, deletedAt: null }).lean();

/** Finalises yesterday for every tenant: auto-marks absent/holiday/week-off/leave and flags INCOMPLETE. */
export async function dailyAttendanceProcessing(now = new Date()) {
  for (const c of await activeCompanies()) {
    const yesterday = addDaysToKey(dateKeyInTz(now, c.timezone), -1);
    const n = await recomputeCompanyDay(c._id, yesterday, { now });
    await AttendanceRecord.updateMany({ companyId: c._id, date: yesterday, finalizedAt: null }, { finalizedAt: now });
    logger.info({ msg: "daily attendance processed", companyId: String(c._id), date: yesterday, employees: n });
  }
}

export async function subscriptionChecks(now = new Date()) {
  const expired = await Subscription.find({ status: { $in: [SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE] }, currentPeriodEnd: { $lt: now } }).lean();
  for (const s of expired) {
    await Subscription.updateOne({ _id: s._id }, { status: SUBSCRIPTION_STATUS.EXPIRED });
    const admins = await User.find({ companyId: s.companyId, role: "COMPANY" }).select("_id").lean();
    for (const a of admins) await notify({ companyId: s.companyId, userId: a._id, title: "Subscription expired", body: "Renew to continue using the service." });
  }
}

export async function monthlyFinalization(now = new Date()) {
  for (const c of await activeCompanies()) {
    const today = dateKeyInTz(now, c.timezone);
    if (today.slice(8) !== "01") continue;
    const prev = addDaysToKey(today, -1);
    await AttendanceRecord.updateMany({ companyId: c._id, date: { $gte: `${prev.slice(0, 7)}-01`, $lte: prev }, finalizedAt: null }, { finalizedAt: now });
  }
}

export function startJobs() {
  const safe = (name, fn) => async () => {
    try { await fn(); } catch (err) { logger.error({ msg: `job ${name} failed`, err: err.message }); }
  };
  // Hourly so every timezone gets processed shortly after its own midnight; operations are idempotent.
  cron.schedule("15 * * * *", safe("dailyAttendanceProcessing", dailyAttendanceProcessing));
  cron.schedule("0 2 * * *", safe("subscriptionChecks", subscriptionChecks));
  cron.schedule("45 3 * * *", safe("monthlyFinalization", monthlyFinalization));
  logger.info({ msg: "background jobs scheduled" });
}
