import * as svc from "../services/employee.service.js";
import { ok, created, paginated } from "../utils/response.js";
import { auditContext } from "../services/audit.service.js";

const tenant = (req) => req.user.companyId;

export const list = async (req, res) => paginated(res, await svc.listEmployees(tenant(req), req.validated.query));
export const designations = async (req, res) => ok(res, await svc.listDesignations(tenant(req)));
export const get = async (req, res) => ok(res, await svc.getEmployee(tenant(req), req.validated.params.id));
export const create = async (req, res) => created(res, await svc.createEmployee(auditContext(req), tenant(req), req.validated.body), "Employee created successfully");
export const update = async (req, res) => ok(res, await svc.updateEmployee(auditContext(req), tenant(req), req.validated.params.id, req.validated.body), "Employee updated successfully");
export const remove = async (req, res) => {
  await svc.deleteEmployee(auditContext(req), tenant(req), req.validated.params.id);
  return ok(res, null, "Employee deleted successfully");
};
