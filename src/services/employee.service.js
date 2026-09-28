import { Employee, Department, Shift, Subscription, FaceProfile, User } from "../models/index.js";
import { EMPLOYEE_STATUS, FACE_PROFILE_STATUS, ROLES } from "../constants/index.js";
import { hashPassword } from "../utils/crypto.js";
import { AuthorizationError, ConflictError, NotFoundError, BadRequestError } from "../utils/errors.js";
import { revokeAllForUser } from "./token.service.js";
import { paginateQuery, escapeRegex } from "../utils/pagination.js";
import { recordAudit } from "./audit.service.js";

const POPULATE = [
  { path: "departmentId", select: "name code canApproveLeave canAddEmployees" },
  { path: "shiftId", select: "name startTime endTime" },
];

async function assertRefsInTenant(companyId, { departmentId, shiftId }) {
  if (departmentId && !(await Department.exists({ _id: departmentId, companyId }))) throw new BadRequestError("Department not found in your company");
  if (shiftId && !(await Shift.exists({ _id: shiftId, companyId }))) throw new BadRequestError("Shift not found in your company");
}

/* ---------- the employee's optional login (role EMPLOYEE), kept in step with the employee record ---------- */
const fullName = (e) => `${e.firstName} ${e.lastName}`.trim();
const loginOf = (companyId, employeeId) => User.findOne({ companyId, employeeId, role: ROLES.EMPLOYEE });

async function assertEmailFree(email, exceptUserId) {
  const taken = await User.findOne({ email }).select("_id").lean();
  if (taken && String(taken._id) !== String(exceptUserId ?? "")) throw new ConflictError("A login with this email already exists", "LOGIN_EMAIL_TAKEN");
}

async function syncLogin(companyId, employee, { password } = {}) {
  let user = await loginOf(companyId, employee._id).select("+passwordHash");
  if (!user && !password) return null;
  const active = employee.status === EMPLOYEE_STATUS.ACTIVE;
  const isNew = !user;
  if (isNew) user = new User({ role: ROLES.EMPLOYEE, companyId, employeeId: employee._id });
  const wasActive = isNew || user.isActive;
  Object.assign(user, { name: fullName(employee), email: employee.email, isActive: active });
  if (password) { user.passwordHash = await hashPassword(password); user.passwordChangedAt = new Date(); }
  await user.save();
  if (!isNew && (password || (wasActive && !active))) await revokeAllForUser(user._id); // re-keyed or switched off: sign out at once
  return user;
}

async function removeLogin(companyId, employeeId) {
  const user = await User.findOneAndDelete({ companyId, employeeId, role: ROLES.EMPLOYEE });
  if (user) await revokeAllForUser(user._id);
}

/** An employee login that may add employees must not be able to raise itself or take over someone else's login. */
function assertEmployeeActorMay(ctx, employee, patch) {
  if (ctx.user?.role !== ROLES.EMPLOYEE) return;
  if (String(employee._id) === ctx.user.employeeId) throw new AuthorizationError("You cannot change your own employee record");
  if (patch.password) throw new AuthorizationError("Only the company can reset an employee's password");
  if (patch.email && patch.email !== employee.email) throw new AuthorizationError("Only the company can change an employee's email");
}

/**
 * Every designation this company has used, for the suggestions in the employee form. Nothing is stored separately:
 * typing a new one on an employee is what adds it. Past employees count too, so a title does not vanish when someone leaves.
 */
export async function listDesignations(companyId) {
  const used = await Employee.distinct("designation", { companyId, designation: { $nin: [null, ""] } });
  const bySpelling = new Map(); // "engineer" and "Engineer" are the same title
  for (const d of used.map((x) => x.trim()).filter(Boolean).sort()) if (!bySpelling.has(d.toLowerCase())) bySpelling.set(d.toLowerCase(), d);
  return [...bySpelling.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function listEmployees(companyId, q) {
  const filter = { companyId };
  if (q.department) filter.departmentId = q.department;
  if (q.shift) filter.shiftId = q.shift;
  if (q.status) filter.status = q.status;
  if (q.designation) filter.designation = new RegExp(`^${escapeRegex(q.designation)}$`, "i");
  if (q.joinedFrom || q.joinedTo) filter.dateOfJoining = { ...(q.joinedFrom && { $gte: q.joinedFrom }), ...(q.joinedTo && { $lte: q.joinedTo }) };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), "i");
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { employeeCode: rx }];
  }
  const page = await paginateQuery(Employee, filter, q, { sortable: ["firstName", "lastName", "employeeCode", "dateOfJoining", "createdAt"], populate: POPULATE, defaultSort: "employeeCode" });
  const enrolled = new Set((await FaceProfile.find({ companyId, employeeId: { $in: page.items.map((e) => e._id) }, status: FACE_PROFILE_STATUS.ACTIVE }).select("employeeId").lean()).map((p) => String(p.employeeId)));
  const logins = new Set((await User.find({ companyId, role: ROLES.EMPLOYEE, employeeId: { $in: page.items.map((e) => e._id) } }).select("employeeId").lean()).map((u) => String(u.employeeId)));
  page.items = page.items.map((e) => ({ ...e, faceRegistered: enrolled.has(String(e._id)), hasLogin: logins.has(String(e._id)) }));
  return page;
}

const deactivateFace = (companyId, employeeId) =>
  FaceProfile.updateMany({ companyId, employeeId, status: FACE_PROFILE_STATUS.ACTIVE }, { status: FACE_PROFILE_STATUS.DEACTIVATED, deactivatedAt: new Date() });

export async function getEmployee(companyId, id) {
  const e = await Employee.findOne({ _id: id, companyId }).populate(POPULATE).lean();
  if (!e) throw new NotFoundError("Employee not found");
  const face = await FaceProfile.exists({ companyId, employeeId: id, status: FACE_PROFILE_STATUS.ACTIVE });
  return { ...e, faceRegistered: Boolean(face), hasLogin: Boolean(await User.exists({ companyId, employeeId: id, role: ROLES.EMPLOYEE })) };
}

export async function createEmployee(ctx, companyId, { password, ...input }) {
  await assertRefsInTenant(companyId, input);
  if (password) await assertEmailFree(input.email);

  const sub = await Subscription.findOne({ companyId }).lean();
  if (sub?.employeeLimit && (await Employee.countDocuments({ companyId })) >= sub.employeeLimit) {
    throw new ConflictError("Employee limit for your plan has been reached", "PLAN_LIMIT");
  }
  const employee = await Employee.create({ ...input, companyId });
  if (password) await syncLogin(companyId, employee, { password });
  await recordAudit(ctx, { action: "employee.created", entityType: "Employee", entityId: employee._id, after: { ...employee.toObject(), loginCreated: Boolean(password) }, companyId });
  return { ...employee.toObject(), hasLogin: Boolean(password) };
}

export async function updateEmployee(ctx, companyId, id, { password, ...data }) {
  await assertRefsInTenant(companyId, data);
  const emp = await Employee.findOne({ _id: id, companyId });
  if (!emp) throw new NotFoundError("Employee not found");
  assertEmployeeActorMay(ctx, emp, { password, ...data });
  const login = await loginOf(companyId, id).select("_id").lean();
  if ((login || password) && (password || (data.email && data.email !== emp.email))) await assertEmailFree(data.email ?? emp.email, login?._id);
  const before = emp.toObject();
  Object.assign(emp, data);
  await emp.save();
  await syncLogin(companyId, emp, { password });
  if (data.status && data.status !== EMPLOYEE_STATUS.ACTIVE) await deactivateFace(companyId, id); // minimise biometric retention

  await recordAudit(ctx, { action: "employee.updated", entityType: "Employee", entityId: id, before, after: { ...emp.toObject(), ...(password && { loginPasswordSet: true }) }, companyId });
  return emp;
}

export async function deleteEmployee(ctx, companyId, id) {
  const emp = await Employee.findOne({ _id: id, companyId });
  if (!emp) throw new NotFoundError("Employee not found");
  const before = emp.toObject();
  emp.deletedAt = new Date();
  emp.deletedBy = ctx.user.id;
  emp.status = EMPLOYEE_STATUS.TERMINATED;
  await emp.save();
  await deactivateFace(companyId, id);
  await removeLogin(companyId, id);
  await recordAudit(ctx, { action: "employee.deleted", entityType: "Employee", entityId: id, before, companyId });
}
