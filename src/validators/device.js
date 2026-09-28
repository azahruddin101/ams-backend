import { z, email, password, listQuery } from "./common.js";

export const createDeviceSchema = z.object({ name: z.string().trim().min(2).max(80), email, password });
export const updateDeviceSchema = z.object({ name: z.string().trim().min(2).max(80), isActive: z.boolean(), password }).partial().strict();
export const deviceListQuery = listQuery;
