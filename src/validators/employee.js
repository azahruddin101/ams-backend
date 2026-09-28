import { z, email, password, objectId, listQuery } from "./common.js";
import { EMPLOYEE_STATUS } from "../constants/index.js";

const fields = {
  employeeCode: z.string().min(1).max(30),
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(1).max(60),
  email,
  phone: z.string().max(30).optional(),
  dateOfJoining: z.coerce.date(),
  departmentId: objectId.optional(),
  shiftId: objectId.optional(),
  designation: z.string().trim().max(80).optional(),
  employmentType: z.string().min(2).max(40).optional(),
  monthlySalary: z.number().min(0).max(1_000_000_000), // company currency
  status: z.enum(Object.values(EMPLOYEE_STATUS)).optional(),
};
/** `password` creates the employee's login (or, on update, resets it). Without it the employee simply has no login. */
export const createEmployeeSchema = z.object({ ...fields, password: password.optional() }).strict();
export const updateEmployeeSchema = z.object({ ...fields, password }).partial().strict();
export const employeeListQuery = listQuery.extend({
  department: objectId.optional(),
  shift: objectId.optional(),
  status: z.enum(Object.values(EMPLOYEE_STATUS)).optional(),
  designation: z.string().max(80).optional(),
  joinedFrom: z.coerce.date().optional(),
  joinedTo: z.coerce.date().optional(),
});
