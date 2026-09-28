import * as svc from "../services/attendance.service.js";
import * as face from "../services/face.service.js";
import * as policy from "../services/policy.service.js";
import * as devices from "../services/device.service.js";
import { ok, created, paginated } from "../utils/response.js";
import { auditContext } from "../services/audit.service.js";

/* scanning (attendance device or company user) */
export const scan = async (req, res) =>
  ok(res, await devices.scan({ actor: req.user, embedding: req.validated.body.embedding, location: req.validated.body.location, ip: req.ip, userAgent: req.get("user-agent") }), "Scan processed");

export async function scanConfig(req, res) {
  const p = await policy.getPolicy(req.user.companyId);
  return ok(res, { deviceName: req.user.name, companyName: req.company.name, timezone: req.company.timezone, geofenceEnabled: p.geofenceEnabled });
}

/* company: records & corrections */
export const list = async (req, res) => paginated(res, await svc.listRecords(req.user.companyId, req.validated.query));
export const manualEvent = async (req, res) => {
  const { employeeId, ...rest } = req.validated.body;
  return ok(res, await svc.addManualEvent(auditContext(req), req.user.companyId, employeeId, rest), "Attendance updated");
};
export const voidEvent = async (req, res) => ok(res, await svc.voidEvent(auditContext(req), req.user.companyId, req.validated.params.id, req.validated.body.reason), "Attendance event voided");

/* policy */
export const getPolicy = async (req, res) => ok(res, await policy.getPolicy(req.user.companyId));
export const updatePolicy = async (req, res) => ok(res, await policy.updatePolicy(auditContext(req), req.user.companyId, req.validated.body), "Attendance policy updated");

export const listDepartmentPolicies = async (req, res) => ok(res, await policy.listDepartmentPolicies(req.user.companyId));
export const getDepartmentPolicy = async (req, res) => ok(res, await policy.getDepartmentPolicy(req.user.companyId, req.validated.params.departmentId));
export const setDepartmentPolicy = async (req, res) => ok(res, await policy.setDepartmentPolicy(auditContext(req), req.user.companyId, req.validated.params.departmentId, req.validated.body), "Department rules updated");
export const resetDepartmentPolicy = async (req, res) => ok(res, await policy.resetDepartmentPolicy(auditContext(req), req.user.companyId, req.validated.params.departmentId), "Department now follows the company rules");

/* face enrolment (company) */
export const faceRegisterFor = async (req, res) => ok(res, await face.registerFace(auditContext(req), req.user.companyId, req.validated.params.employeeId, req.validated.body), "Face registered");
export const faceDeactivate = async (req, res) => ok(res, await face.deactivateFace(auditContext(req), req.user.companyId, req.validated.params.employeeId), "Face profile deactivated");
export const faceLogs = async (req, res) => ok(res, await face.listFaceLogs(req.user.companyId, req.validated.query.employeeId));

/* attendance devices (company) */
export const deviceList = async (req, res) => paginated(res, await devices.listDevices(req.user.companyId, req.validated.query));
export const deviceCreate = async (req, res) => created(res, await devices.createDevice(auditContext(req), req.user.companyId, req.validated.body), "Attendance device created");
export const deviceUpdate = async (req, res) => ok(res, await devices.updateDevice(auditContext(req), req.user.companyId, req.validated.params.id, req.validated.body), "Attendance device updated");
export const deviceRemove = async (req, res) => {
  await devices.removeDevice(auditContext(req), req.user.companyId, req.validated.params.id);
  return ok(res, null, "Attendance device deleted");
};
