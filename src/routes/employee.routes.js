import { defineRoutes } from "../utils/routeBuilder.js";
import * as c from "../controllers/employee.controller.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { createEmployeeSchema, updateEmployeeSchema, employeeListQuery } from "../validators/employee.js";
import { idParams } from "../validators/common.js";

export default defineRoutes({ prefix: "/employees", tag: "Employees" }, [
  { method: "get", path: "/", summary: "List employees (search, department, status, designation, shift, joining date)", permission: P.EMPLOYEE_READ, query: employeeListQuery, handler: c.list },
  { method: "post", path: "/", summary: "Create an employee (+ optional login) atomically", permission: P.EMPLOYEE_CREATE, body: createEmployeeSchema, handler: c.create },
  { method: "get", path: "/designations", summary: "Designations this company has used (suggestions for the employee form)", permission: P.EMPLOYEE_READ, handler: c.designations },
  { method: "get", path: "/:id", summary: "Get an employee", permission: P.EMPLOYEE_READ, params: idParams, handler: c.get },
  { method: "patch", path: "/:id", summary: "Update an employee", permission: P.EMPLOYEE_UPDATE, params: idParams, body: updateEmployeeSchema, handler: c.update },
  { method: "delete", path: "/:id", summary: "Soft-delete an employee and disable login", permission: P.EMPLOYEE_DELETE, params: idParams, handler: c.remove },
]);
