import { ok, created, paginated } from "../utils/response.js";
import { auditContext } from "../services/audit.service.js";

/** Builds thin controllers for a tenant CRUD service. */
export const crudController = (svc, label) => ({
  list: async (req, res) => paginated(res, await svc.list(req.user.companyId, req.validated.query)),
  get: async (req, res) => ok(res, await svc.get(req.user.companyId, req.validated.params.id)),
  create: async (req, res) => created(res, await svc.create(auditContext(req), req.user.companyId, req.validated.body), `${label} created successfully`),
  update: async (req, res) => ok(res, await svc.update(auditContext(req), req.user.companyId, req.validated.params.id, req.validated.body), `${label} updated successfully`),
  remove: async (req, res) => {
    await svc.remove(auditContext(req), req.user.companyId, req.validated.params.id);
    return ok(res, null, `${label} deleted successfully`);
  },
});
