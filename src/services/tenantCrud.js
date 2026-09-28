import { NotFoundError, ConflictError } from "../utils/errors.js";
import { paginateQuery, escapeRegex } from "../utils/pagination.js";
import { recordAudit } from "./audit.service.js";

/**
 * Tenant-scoped CRUD factory. Every query is forced through `{ companyId }`, and any
 * client-supplied companyId in payloads is stripped, so cross-tenant access is impossible by construction.
 */
export function createTenantCrud(Model, { entity, searchFields = ["name"], sortable = ["createdAt", "name"], defaultSort = "createdAt", softDelete = true, inUseCheck, extraFilters = () => ({}), populate } = {}) {
  const strip = ({ companyId: _c, _id: _i, deletedAt: _d, ...rest }) => rest;
  const scoped = (companyId, id) => ({ _id: id, companyId });

  return {
    async list(companyId, query) {
      const filter = { companyId, ...extraFilters(query) };
      if (query.search) {
        const rx = new RegExp(escapeRegex(query.search), "i");
        filter.$or = searchFields.map((f) => ({ [f]: rx }));
      }
      return paginateQuery(Model, filter, query, { sortable, defaultSort, populate });
    },
    async get(companyId, id) {
      const doc = await Model.findOne(scoped(companyId, id)).lean();
      if (!doc) throw new NotFoundError(`${entity} not found`);
      return doc;
    },
    async create(ctx, companyId, data) {
      const doc = await Model.create({ ...strip(data), companyId });
      await recordAudit(ctx, { action: `${entity.toLowerCase()}.created`, entityType: entity, entityId: doc._id, after: doc, companyId });
      return doc;
    },
    async update(ctx, companyId, id, patch) {
      const doc = await Model.findOne(scoped(companyId, id));
      if (!doc) throw new NotFoundError(`${entity} not found`);
      const before = doc.toObject();
      Object.assign(doc, strip(patch));
      await doc.save();
      await recordAudit(ctx, { action: `${entity.toLowerCase()}.updated`, entityType: entity, entityId: doc._id, before, after: doc, companyId });
      return doc;
    },
    async remove(ctx, companyId, id) {
      const doc = await Model.findOne(scoped(companyId, id));
      if (!doc) throw new NotFoundError(`${entity} not found`);
      if (inUseCheck && (await inUseCheck(companyId, id))) throw new ConflictError(`${entity} is in use and cannot be deleted`, "IN_USE");
      const before = doc.toObject();
      if (softDelete) {
        doc.deletedAt = new Date();
        doc.deletedBy = ctx.user.id;
        await doc.save();
      } else {
        await doc.deleteOne();
      }
      await recordAudit(ctx, { action: `${entity.toLowerCase()}.deleted`, entityType: entity, entityId: doc._id, before, companyId });
    },
  };
}
