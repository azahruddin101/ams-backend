import { env } from "../config/env.js";
import { ROLES } from "../constants/index.js";
import { AuthorizationError, BadRequestError, ConflictError } from "../utils/errors.js";
import { addDaysToKey, dateKeyInTz } from "../utils/time.js";
import { dailyAttendanceProcessing, monthlyFinalization, subscriptionChecks } from "../jobs/index.js";
import { recordAudit } from "./audit.service.js";

const MAX_CATCH_UP_DAYS = 31;

/** The jobs that can be run by hand. The platform admin runs them for every company; a company only for itself. */
const JOBS = {
  daily: { label: "Daily attendance", platformOnly: false, run: (now, o) => dailyAttendanceProcessing(now, o) },
  monthly: { label: "Month closing", platformOnly: false, run: (now, o) => monthlyFinalization(now, { companyId: o.companyId, force: true }) },
  subscriptions: { label: "Subscription checks", platformOnly: true, run: (now, o) => subscriptionChecks(now, { companyId: o.companyId }) },
};
const running = new Set(); // one run of a job per scope at a time (per server process)

export const jobStatus = (user) => ({
  scheduled: env.jobsEnabled, // false = nothing runs on its own
  jobs: Object.entries(JOBS).filter(([, j]) => user.role === ROLES.SUPER_ADMIN || !j.platformOnly).map(([key, j]) => ({ key, label: j.label })),
});

export async function runJobs(ctx, { jobs, from }, company) {
  const { user } = ctx;
  const platform = user.role === ROLES.SUPER_ADMIN;
  const companyId = platform ? undefined : user.companyId;
  const keys = jobs?.length ? [...new Set(jobs)] : jobStatus(user).jobs.map((j) => j.key);
  if (keys.some((k) => JOBS[k].platformOnly) && !platform) throw new AuthorizationError();

  const now = new Date();
  if (from) {
    const yesterday = addDaysToKey(dateKeyInTz(now, company?.timezone ?? "UTC"), -1);
    if (from > yesterday) throw new BadRequestError("Choose a day before today: today is still in progress");
    if (from < addDaysToKey(yesterday, -(MAX_CATCH_UP_DAYS - 1))) throw new BadRequestError(`You can catch up at most ${MAX_CATCH_UP_DAYS} days at a time`);
  }
  const lock = companyId ?? "platform";
  if (running.has(lock)) throw new ConflictError("These jobs are already running. Please wait for them to finish.", "JOBS_RUNNING");
  running.add(lock);
  const results = [];
  try {
    for (const key of keys) {
      const started = Date.now();
      try {
        results.push({ key, label: JOBS[key].label, ok: true, summary: await JOBS[key].run(now, { companyId, from }), ms: Date.now() - started });
      } catch (err) {
        results.push({ key, label: JOBS[key].label, ok: false, error: err.message, ms: Date.now() - started }); // one failing job does not stop the others
      }
    }
  } finally {
    running.delete(lock);
  }
  await recordAudit(ctx, { action: "jobs.run_manually", entityType: "Job", after: { scope: platform ? "all companies" : "own company", from, results }, companyId: companyId ?? null });
  return { scope: platform ? "ALL_COMPANIES" : "COMPANY", ranAt: now, results };
}
