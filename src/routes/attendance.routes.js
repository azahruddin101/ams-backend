import { z } from "zod";
import { defineRoutes } from "../utils/routeBuilder.js";
import * as c from "../controllers/attendance.controller.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { scanLimiter } from "../middlewares/rateLimit.js";
import { scanSchema, faceInputSchema, manualEventSchema, voidEventSchema, recordListQuery, updatePolicySchema, departmentPolicySchema, departmentIdParams, employeeIdParams } from "../validators/attendance.js";
import { createDeviceSchema, updateDeviceSchema, deviceListQuery } from "../validators/device.js";
import { idParams, objectId } from "../validators/common.js";

export const attendanceRoutes = defineRoutes({ prefix: "/attendance", tag: "Attendance" }, [
  { method: "post", path: "/scan", summary: "Scan a face: identifies the employee (1:N, this company only) and toggles check-in/check-out",
    description: "Used by attendance devices (and company users). Unknown or ambiguous faces never record attendance. Time, shift and lateness are all decided by the server; a per-employee cooldown returns outcome COOLDOWN.",
    permission: P.ATTENDANCE_SCAN, limiter: scanLimiter, body: scanSchema, handler: c.scan },
  { method: "get", path: "/scan-config", summary: "Company/device info the scanner screen needs", permission: P.ATTENDANCE_SCAN, handler: c.scanConfig },
  { method: "get", path: "/", summary: "List attendance records (company)", permission: P.ATTENDANCE_READ, query: recordListQuery, handler: c.list },
  { method: "post", path: "/manual", summary: "Add a manual check-in/out event (audited)", permission: P.ATTENDANCE_UPDATE, body: manualEventSchema, handler: c.manualEvent },
  { method: "post", path: "/events/:id/void", summary: "Void an event (audited, never deleted)", permission: P.ATTENDANCE_UPDATE, params: idParams, body: voidEventSchema, handler: c.voidEvent },
]);

export const policyRoutes = defineRoutes({ prefix: "/attendance-policies", tag: "Attendance Policies" }, [
  { method: "get", path: "/", summary: "Get the company attendance policy", permission: P.POLICY_READ, handler: c.getPolicy },
  { method: "put", path: "/", summary: "Update the company's default rules (timing, in/out, late penalties, salary deduction, geofence)", permission: P.POLICY_UPDATE, body: updatePolicySchema, handler: c.updatePolicy },
  { method: "get", path: "/departments", summary: "Departments and whether each follows the company default or has its own rules", permission: P.POLICY_READ, handler: c.listDepartmentPolicies },
  { method: "get", path: "/departments/:departmentId", summary: "The rules that apply to a department", permission: P.POLICY_READ, params: departmentIdParams, handler: c.getDepartmentPolicy },
  { method: "put", path: "/departments/:departmentId", summary: "Give a department its own rules (starts from the company default)", permission: P.POLICY_UPDATE, params: departmentIdParams, body: departmentPolicySchema, handler: c.setDepartmentPolicy },
  { method: "delete", path: "/departments/:departmentId", summary: "Remove a department's own rules: it follows the company default again", permission: P.POLICY_UPDATE, params: departmentIdParams, handler: c.resetDepartmentPolicy },
]);

export const faceRoutes = defineRoutes({ prefix: "/face", tag: "Face" }, [
  { method: "post", path: "/employees/:employeeId/register", summary: "Register / re-register an employee's face template (rejects a face already enrolled)", permission: P.FACE_MANAGE, params: employeeIdParams, body: faceInputSchema, handler: c.faceRegisterFor },
  { method: "delete", path: "/employees/:employeeId", summary: "Deactivate an employee's face profile", permission: P.FACE_MANAGE, params: employeeIdParams, handler: c.faceDeactivate },
  { method: "get", path: "/logs", summary: "Face scan / enrolment logs (no biometric data)", permission: P.FACE_MANAGE, query: z.object({ employeeId: objectId.optional() }), handler: c.faceLogs },
]);

export const deviceRoutes = defineRoutes({ prefix: "/devices", tag: "Attendance Devices" }, [
  { method: "get", path: "/", summary: "List this company's attendance devices", permission: P.DEVICE_MANAGE, query: deviceListQuery, handler: c.deviceList },
  { method: "post", path: "/", summary: "Create an attendance device login (role ATTENDANCE_DEVICE: can only scan)", permission: P.DEVICE_MANAGE, body: createDeviceSchema, handler: c.deviceCreate },
  { method: "patch", path: "/:id", summary: "Rename, enable/disable, or reset the password of a device (signs it out)", permission: P.DEVICE_MANAGE, params: idParams, body: updateDeviceSchema, handler: c.deviceUpdate },
  { method: "delete", path: "/:id", summary: "Delete an attendance device", permission: P.DEVICE_MANAGE, params: idParams, handler: c.deviceRemove },
]);
