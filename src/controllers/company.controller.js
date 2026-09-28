import * as svc from "../services/company.service.js";
import { ok, created, paginated } from "../utils/response.js";
import { auditContext } from "../services/audit.service.js";

const ctx = auditContext;

export const list = async (req, res) => paginated(res, await svc.listCompanies(req.validated.query));
export const create = async (req, res) => created(res, await svc.createCompany(ctx(req), req.validated.body), "Company created successfully");
export const stats = async (_req, res) => ok(res, await svc.platformStats());
export const get = async (req, res) => ok(res, await svc.getCompany(req.validated.params.id));
export const update = async (req, res) => ok(res, await svc.updateCompany(ctx(req), req.validated.params.id, req.validated.body), "Company updated successfully");
export const setStatus = async (req, res) => ok(res, await svc.setCompanyStatus(ctx(req), req.validated.params.id, req.validated.body.status), "Company status updated");
export const createAdmin = async (req, res) => created(res, await svc.createCompanyAdmin(ctx(req), req.validated.params.id, req.validated.body), "Company admin created");
export const remove = async (req, res) => {
  await svc.deleteCompany(ctx(req), req.validated.params.id, req.validated.body.confirmName);
  return ok(res, null, "Company and all its data permanently deleted");
};
export const getMine = async (req, res) => ok(res, await svc.getOwnCompany(req.user.companyId));
export const updateMine = async (req, res) => ok(res, await svc.updateCompany(ctx(req), req.user.companyId, req.validated.body), "Company updated successfully");
