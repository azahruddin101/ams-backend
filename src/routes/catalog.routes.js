import { defineRoutes } from "../utils/routeBuilder.js";
import { crudController } from "../controllers/crud.controller.js";
import { departmentService, shiftService, holidayService, leaveTypeService } from "../services/catalog.service.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { idParams, listQuery } from "../validators/common.js";
import { departmentSchema, departmentUpdateSchema, departmentListQuery, shiftSchema, shiftUpdateSchema, holidaySchema, holidayUpdateSchema, holidayListQuery, leaveTypeSchema, leaveTypeUpdateSchema } from "../validators/org.js";

function crud({ prefix, tag, label, svc, read, write, del, create, update, listSchema }) {
  const c = crudController(svc, label);
  return defineRoutes({ prefix, tag }, [
    { method: "get", path: "/", summary: `List ${tag.toLowerCase()}`, permission: read, query: listSchema ?? listQuery, handler: c.list },
    { method: "post", path: "/", summary: `Create ${label.toLowerCase()}`, permission: write.create ?? write, body: create, handler: c.create },
    { method: "get", path: "/:id", summary: `Get ${label.toLowerCase()}`, permission: read, params: idParams, handler: c.get },
    { method: "patch", path: "/:id", summary: `Update ${label.toLowerCase()}`, permission: write.update ?? write, params: idParams, body: update, handler: c.update },
    { method: "delete", path: "/:id", summary: `Delete ${label.toLowerCase()}`, permission: del ?? write, params: idParams, handler: c.remove },
  ]);
}

export const departmentRoutes = crud({ prefix: "/departments", tag: "Departments", label: "Department", svc: departmentService, read: P.DEPARTMENT_READ, write: P.DEPARTMENT_MANAGE, create: departmentSchema, update: departmentUpdateSchema, listSchema: departmentListQuery });
export const shiftRoutes = crud({ prefix: "/shifts", tag: "Shifts", label: "Shift", svc: shiftService, read: P.SHIFT_READ, write: { create: P.SHIFT_CREATE, update: P.SHIFT_UPDATE }, del: P.SHIFT_DELETE, create: shiftSchema, update: shiftUpdateSchema });
export const holidayRoutes = crud({ prefix: "/holidays", tag: "Holidays", label: "Holiday", svc: holidayService, read: P.HOLIDAY_READ, write: P.HOLIDAY_MANAGE, create: holidaySchema, update: holidayUpdateSchema, listSchema: holidayListQuery });
export const leaveTypeRoutes = crud({ prefix: "/leave-types", tag: "Leaves", label: "Leave type", svc: leaveTypeService, read: P.LEAVE_READ, write: P.LEAVE_TYPE_MANAGE, create: leaveTypeSchema, update: leaveTypeUpdateSchema });
