import mongoose from "mongoose";
import { Company, User, AttendancePolicy, Subscription, LeaveType, Employee, AttendanceEvent, RefreshToken } from "../models/index.js";
import { ROLES, COMPANY_STATUS } from "../constants/index.js";
import { hashPassword } from "../utils/crypto.js";
import { ConflictError, NotFoundError, BadRequestError } from "../utils/errors.js";
import { withTransaction, opts } from "../utils/transaction.js";
import { paginateQuery, escapeRegex } from "../utils/pagination.js";
import { isValidTimezone, dateKeyInTz } from "../utils/time.js";
import { recordAudit } from "./audit.service.js";
import { defaultPolicy } from "./policy.service.js";

const DEFAULT_LEAVE_TYPES = [
  { name: "Casual Leave", code: "CL", annualQuota: 12, isPaid: true },
  { name: "Sick Leave", code: "SL", annualQuota: 10, isPaid: true },
  { name: "Unpaid Leave", code: "LWP", annualQuota: 365, isPaid: false },
];

export async function createCompany(ctx, input) {
  if (!isValidTimezone(input.timezone)) throw new BadRequestError("Invalid timezone");
  const { admin, ...companyData } = input;
  if (admin && (await User.exists({ email: admin.email }))) throw new ConflictError("A user with this email already exists");

  const passwordHash = admin ? await hashPassword(admin.password) : null;
  let createdCompany;
  try {
    await withTransaction(async (session) => {
      const [company] = await Company.create([{ ...companyData, createdBy: ctx.user.id }], opts(session));
      createdCompany = company;
      await AttendancePolicy.create([{ companyId: company._id, ...defaultPolicy() }], opts(session));
      await Subscription.create([{ companyId: company._id }], opts(session));
      await LeaveType.create(DEFAULT_LEAVE_TYPES.map((l) => ({ ...l, companyId: company._id })), opts(session));
      if (admin) {
        await User.create([{ name: admin.name, email: admin.email, passwordHash, role: ROLES.COMPANY, companyId: company._id }], opts(session));
      }
    });
  } catch (err) {
    // Standalone MongoDB has no transactions: compensate so we never leave a half-created tenant.
    if (createdCompany) await purgeCompany(createdCompany._id);
    throw err;
  }
  await recordAudit(ctx, { action: "company.created", entityType: "Company", entityId: createdCompany._id, after: createdCompany, companyId: createdCompany._id });
  return createdCompany;
}

/**
 * Permanently removes a tenant and EVERYTHING it owns: every collection that has a `companyId` (employees incl. soft-deleted,
 * attendance events/records, face templates + logs, leave, notifications, its audit trail, users…), the sessions of its
 * users, and the company itself. Discovering collections from the schemas means a future model can't be forgotten here.
 */
async function purgeCompany(companyId) {
  const userIds = (await User.find({ companyId }).select("_id").lean()).map((u) => u._id);
  await RefreshToken.deleteMany({ userId: { $in: userIds } });
  for (const Model of Object.values(mongoose.models)) {
    if (Model === Company || Model === RefreshToken || !Model.schema.path("companyId")) continue;
    await Model.deleteMany({ companyId });
  }
  await Company.deleteOne({ _id: companyId });
}

/** Super admin only. Irreversible, so the caller must type the company's exact name. Leaves one platform-level audit record. */
export async function deleteCompany(ctx, id, confirmName) {
  const company = await Company.findById(id).lean();
  if (!company) throw new NotFoundError("Company not found");
  if (confirmName !== company.name) throw new BadRequestError("Type the company name exactly to confirm deletion", "CONFIRMATION_MISMATCH");
  const [employees, users] = await Promise.all([Employee.countDocuments({ companyId: id }), User.countDocuments({ companyId: id })]);
  await purgeCompany(id);
  await recordAudit(ctx, { action: "company.deleted", entityType: "Company", entityId: id, companyId: null, before: { name: company.name, email: company.email, status: company.status, employees, users } });
}

export async function listCompanies(query) {
  const filter = { deletedAt: null };
  if (query.status) filter.status = query.status;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { email: rx }];
  }
  return paginateQuery(Company, filter, query, { sortable: ["name", "createdAt", "status"], select: "-logo" }); // logos are heavy: list rows do not need them
}

export async function getCompany(id) {
  const company = await Company.findOne({ _id: id, deletedAt: null }).lean();
  if (!company) throw new NotFoundError("Company not found");
  const [employees, admins] = await Promise.all([
    Employee.countDocuments({ companyId: id }),
    User.find({ companyId: id, role: ROLES.COMPANY }).select("name email isActive lastLoginAt").lean(),
  ]);
  return { ...company, employeeCount: employees, admins };
}

export async function updateCompany(ctx, id, patch) {
  if (patch.timezone && !isValidTimezone(patch.timezone)) throw new BadRequestError("Invalid timezone");
  const before = await Company.findOne({ _id: id, deletedAt: null });
  if (!before) throw new NotFoundError("Company not found");
  const beforeSnap = before.toObject();
  const { settings, address, theme, ...rest } = patch;
  Object.assign(before, rest);
  if (theme) before.theme = { ...(before.theme?.toObject?.() ?? {}), ...theme };
  if (address) before.address = { ...(before.address?.toObject?.() ?? {}), ...address };
  if (settings) {
    const { geofence, ...s } = settings;
    Object.assign(before.settings, s);
    if (geofence) Object.assign(before.settings.geofence, geofence);
  }
  await before.save();
  await recordAudit(ctx, { action: "company.updated", entityType: "Company", entityId: id, before: beforeSnap, after: before, companyId: id });
  return before;
}

export async function setCompanyStatus(ctx, id, status) {
  const c = await Company.findOne({ _id: id, deletedAt: null });
  if (!c) throw new NotFoundError("Company not found");
  const before = c.status;
  c.status = status;
  await c.save();
  await recordAudit(ctx, { action: "company.status_changed", entityType: "Company", entityId: id, before: { status: before }, after: { status }, companyId: id });
  return c;
}

export async function createCompanyAdmin(ctx, companyId, { name, email, password }) {
  if (!(await Company.exists({ _id: companyId, deletedAt: null }))) throw new NotFoundError("Company not found");
  if (await User.exists({ email })) throw new ConflictError("A user with this email already exists");
  const user = await User.create({ name, email, passwordHash: await hashPassword(password), role: ROLES.COMPANY, companyId });
  await recordAudit(ctx, { action: "user.created", entityType: "User", entityId: user._id, after: { name, email, role: ROLES.COMPANY }, companyId });
  return user;
}

export async function platformStats() {
  const [byStatus, totalEmployees] = await Promise.all([
    Company.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Employee.countDocuments({ status: "ACTIVE" }),
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const startOfDay = new Date(Date.now() - 24 * 3600_000);
  const eventsToday = await AttendanceEvent.countDocuments({ timestamp: { $gte: startOfDay } });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    totalCompanies: total,
    activeCompanies: counts[COMPANY_STATUS.ACTIVE] ?? 0,
    trialCompanies: counts[COMPANY_STATUS.TRIAL] ?? 0,
    suspendedCompanies: counts[COMPANY_STATUS.SUSPENDED] ?? 0,
    totalEmployees,
    attendanceEventsToday: eventsToday,
    asOf: dateKeyInTz(new Date(), "UTC"),
  };
}

export async function getOwnCompany(companyId) {
  const c = await Company.findById(companyId).lean();
  if (!c) throw new NotFoundError("Company not found");
  return c;
}
