import { z } from "zod";
import { PAGINATION } from "../constants/index.js";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  sortBy: z.string().regex(/^[a-zA-Z0-9_.]+$/).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(100).optional(),
});

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Executes a paginated find. `sortable` whitelists sortBy fields. */
export async function paginateQuery(Model, filter, query, { sortable = ["createdAt"], select, populate, defaultSort = "createdAt" } = {}) {
  const { page, limit, sortOrder } = query;
  const sortBy = sortable.includes(query.sortBy) ? query.sortBy : defaultSort;
  let q = Model.find(filter).sort({ [sortBy]: sortOrder === "asc" ? 1 : -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
  if (select) q = q.select(select);
  if (populate) q = q.populate(populate);
  const [items, total] = await Promise.all([q.lean(), Model.countDocuments(filter)]);
  return { items, page, limit, total };
}
