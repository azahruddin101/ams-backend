import * as me from "../services/me.service.js";
import * as leave from "../services/leave.service.js";
import { leaveTypeService } from "../services/catalog.service.js";
import { ok, created, paginated } from "../utils/response.js";
import { auditContext } from "../services/audit.service.js";
import { dateKeyInTz } from "../utils/time.js";

// The employee is always the one behind the login: never taken from the request.
const cid = (req) => req.user.companyId;
const eid = (req) => req.user.employeeId;

export const profile = async (req, res) => ok(res, await me.myProfile(cid(req), eid(req), req.company));
export const attendance = async (req, res) => paginated(res, await me.myAttendance(cid(req), eid(req), req.validated.query));

export const leaves = async (req, res) => paginated(res, await leave.listLeaves(cid(req), { ...req.validated.query, employeeId: eid(req) }));
export const leaveBalance = async (req, res) => ok(res, await leave.leaveBalance(cid(req), eid(req)));
export const leaveTypes = async (req, res) => ok(res, (await leaveTypeService.list(cid(req), { page: 1, limit: 100, sortOrder: "asc" })).items.filter((t) => t.isActive));
export const leaveApprovers = async (req, res) => ok(res, await leave.listApprovers(cid(req), eid(req)));
export const leaveOptions = async (req, res) => ok(res, await leave.leaveOptions(cid(req), eid(req), dateKeyInTz(new Date(), req.company.timezone)));
export const applyLeave = async (req, res) => created(res, await leave.applyLeave(auditContext(req), cid(req), eid(req), req.validated.body), "Leave request sent");
export const withdrawLeave = async (req, res) => ok(res, await leave.withdrawLeave(auditContext(req), cid(req), eid(req), req.validated.params.id), "Leave request withdrawn");

export const approvals = async (req, res) => paginated(res, await leave.listApprovals(cid(req), eid(req), req.validated.query));
