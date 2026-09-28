import { Department, DepartmentPolicy, Shift, Holiday, LeaveType, Employee, LeaveRequest } from "../models/index.js";
import { createTenantCrud } from "./tenantCrud.js";

const departmentCrud = createTenantCrud(Department, {
  entity: "Department",
  searchFields: ["name", "code"],
  sortable: ["name", "code", "createdAt"],
  defaultSort: "name",
  extraFilters: (q) => (q.status ? { status: q.status } : {}),
  inUseCheck: (companyId, id) => Employee.exists({ companyId, departmentId: id }),
});
export const departmentService = {
  ...departmentCrud,
  async remove(ctx, companyId, id) {
    await departmentCrud.remove(ctx, companyId, id);
    await DepartmentPolicy.deleteOne({ companyId, departmentId: id }); // its own rules go with it
  },
};

export const shiftService = createTenantCrud(Shift, {
  entity: "Shift",
  sortable: ["name", "startTime", "createdAt"],
  defaultSort: "name",
  inUseCheck: (companyId, id) => Employee.exists({ companyId, shiftId: id }),
});

export const holidayService = createTenantCrud(Holiday, {
  entity: "Holiday",
  softDelete: false,
  sortable: ["date", "name"],
  defaultSort: "date",
  extraFilters: (q) => (q.year ? { date: { $gte: `${q.year}-01-01`, $lte: `${q.year}-12-31` } } : {}),
});

export const leaveTypeService = createTenantCrud(LeaveType, {
  entity: "LeaveType",
  softDelete: false,
  searchFields: ["name", "code"],
  sortable: ["name", "code"],
  defaultSort: "name",
  inUseCheck: (companyId, id) => LeaveRequest.exists({ companyId, leaveTypeId: id }),
});

/** Holiday lookup honouring recurring holidays (matches month-day in any year). */
export async function holidayMap(companyId, from, to) {
  const rows = await Holiday.find({ companyId }).lean();
  const map = new Map();
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  for (const h of rows) {
    if (h.date >= from && h.date <= to) map.set(h.date, h);
    if (h.recurring) for (const y of years) {
      const k = `${y}${h.date.slice(4)}`;
      if (k >= from && k <= to && !map.has(k)) map.set(k, h);
    }
  }
  return map;
}
