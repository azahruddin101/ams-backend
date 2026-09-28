import "./setup.js";
import request from "supertest";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../src/config/database.js";
import application from "../../src/app.js";
import { User } from "../../src/models/index.js";
import { ROLES } from "../../src/constants/index.js";
import { hashPassword } from "../../src/utils/crypto.js";
import { createCompany } from "../../src/services/company.service.js";
import { createEmployee } from "../../src/services/employee.service.js";
import { Department, Shift } from "../../src/models/index.js";

export const PASSWORD = "TestPassw0rd!x";
const ctx = { user: { id: null }, ip: "test" };

export const app = () => application;
export const api = () => request(app());

export async function boot() {
  await connectDatabase();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}
export const shutdown = () => disconnectDatabase();

export async function login(email, password = PASSWORD) {
  const res = await api().post("/api/v1/auth/login").send({ email, password });
  return { res, token: res.body.data?.accessToken, cookie: res.headers["set-cookie"]?.[0] };
}
export const authed = (token) => ({ Authorization: `Bearer ${token}` });

async function makeTenant(key, timezone) {
  const company = await createCompany(ctx, {
    name: `Company ${key}`, email: `c@${key}.test`, timezone, currency: "INR", status: "ACTIVE",
    admin: { name: `Company ${key} login`, email: `admin@${key}.test`, password: PASSWORD },
  });
  const cid = company._id;
  const dept = await Department.create({ companyId: cid, name: "Eng", code: "ENG" });
  const shift = await Shift.create({ companyId: cid, name: "Day", startTime: "09:00", endTime: "18:00", gracePeriod: 10, requiredWorkingMinutes: 480 });
  const device = await User.create({ name: `Device ${key}`, email: `device@${key}.test`, passwordHash: await hashPassword(PASSWORD), role: ROLES.ATTENDANCE_DEVICE, companyId: cid });
  const emps = [];
  for (let i = 1; i <= 2; i++) {
    emps.push(await createEmployee(ctx, cid, {
      employeeCode: `E${i}`, firstName: "Emp", lastName: `${key}${i}`, email: `emp${i}@${key}.test`, dateOfJoining: new Date("2025-01-01"),
      departmentId: dept._id, shiftId: shift._id, monthlySalary: 30000,
    }));
  }
  return { company, dept, shift, device, emps, adminEmail: `admin@${key}.test`, deviceEmail: `device@${key}.test` };
}

export async function createFixture() {
  await User.create({ name: "Root", email: "root@ams.test", passwordHash: await hashPassword(PASSWORD), role: ROLES.SUPER_ADMIN });
  return { A: await makeTenant("a", "Asia/Kolkata"), B: await makeTenant("b", "America/New_York"), superEmail: "root@ams.test" };
}
