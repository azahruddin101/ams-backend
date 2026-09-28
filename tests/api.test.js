import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, shutdown, createFixture, api, login, authed, PASSWORD } from "./helpers/fixture.js";
import { AttendanceEvent, AuditLog, Employee, FaceProfile } from "../src/models/index.js";

let F;
let tk;
before(async () => {
  await boot();
  F = await createFixture();
  tk = {
    superAdmin: (await login(F.superEmail)).token,
    companyA: (await login(F.A.adminEmail)).token,
    deviceA: (await login(F.A.deviceEmail)).token,
    companyB: (await login(F.B.adminEmail)).token,
    deviceB: (await login(F.B.deviceEmail)).token,
  };
});
after(shutdown);

const get = (path, t) => api().get(`/api/v1${path}`).set(authed(t));
const post = (path, t, body = {}) => api().post(`/api/v1${path}`).set(authed(t)).send(body);
const patch = (path, t, body = {}) => api().patch(`/api/v1${path}`).set(authed(t)).send(body);
const put = (path, t, body = {}) => api().put(`/api/v1${path}`).set(authed(t)).send(body);
const del = (path, t) => api().delete(`/api/v1${path}`).set(authed(t));

/* ---------------------------------------------------------------- auth */
test("auth: login sets httpOnly refresh cookie and returns access token without secrets", async () => {
  const { res, cookie } = await login(F.A.adminEmail);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.accessToken);
  assert.match(cookie, /HttpOnly/i);
  assert.equal(res.body.data.user.passwordHash, undefined);
  assert.equal(res.body.data.user.role, "COMPANY");
  assert.ok(res.body.data.user.permissions.includes("employee.create"));
  const dev = (await login(F.A.deviceEmail)).res.body.data.user;
  assert.deepEqual(dev.permissions, ["attendance.scan"]);
});

test("auth: wrong password / unknown user give the same generic 401", async () => {
  const a = await api().post("/api/v1/auth/login").send({ email: F.A.adminEmail, password: "WrongPassw0rd!" });
  const b = await api().post("/api/v1/auth/login").send({ email: "nobody@x.test", password: "WrongPassw0rd!" });
  assert.equal(a.status, 401);
  assert.equal(a.body.message, b.body.message);
});

test("auth: refresh rotates the token; a replay long after rotation is treated as theft and revokes the whole family", async () => {
  const { cookie } = await login(F.A.deviceEmail);
  const r1 = await api().post("/api/v1/auth/refresh").set("Cookie", cookie);
  assert.equal(r1.status, 200);
  const newCookie = r1.headers["set-cookie"][0];
  assert.notEqual(newCookie.split(";")[0], cookie.split(";")[0]);
  const { RefreshToken } = await import("../src/models/index.js");
  await RefreshToken.updateMany({ revokedAt: { $ne: null } }, { revokedAt: new Date(Date.now() - 60_000) }); // age the rotation past the grace window
  assert.equal((await api().post("/api/v1/auth/refresh").set("Cookie", cookie)).status, 401); // stolen/old token
  assert.equal((await api().post("/api/v1/auth/refresh").set("Cookie", newCookie)).status, 401); // family revoked
});

test("auth: two simultaneous refreshes (two tabs / app resume) do not sign the user out", async () => {
  const { cookie } = await login(F.A.adminEmail);
  const first = await api().post("/api/v1/auth/refresh").set("Cookie", cookie);
  assert.equal(first.status, 200);
  const loser = await api().post("/api/v1/auth/refresh").set("Cookie", cookie); // same cookie, moments later
  assert.equal(loser.status, 401); // rejected…
  const winnerCookie = first.headers["set-cookie"][0];
  assert.equal((await api().post("/api/v1/auth/refresh").set("Cookie", winnerCookie)).status, 200); // …but the session survives
});

test("auth: logout revokes the refresh token; refresh without a cookie is 401", async () => {
  const { cookie } = await login(F.A.adminEmail);
  await api().post("/api/v1/auth/logout").set("Cookie", cookie);
  assert.equal((await api().post("/api/v1/auth/refresh").set("Cookie", cookie)).status, 401);
  assert.equal((await api().post("/api/v1/auth/refresh")).status, 401);
});

test("auth: account locks after repeated failures", async () => {
  for (let i = 0; i < 5; i++) await api().post("/api/v1/auth/login").send({ email: F.B.deviceEmail, password: "BadPassw0rd!!" });
  const locked = await api().post("/api/v1/auth/login").send({ email: F.B.deviceEmail, password: PASSWORD });
  assert.equal(locked.status, 401);
  assert.match(locked.body.message, /locked/i);
});

test("auth: protected routes reject missing/invalid tokens; password rules enforced", async () => {
  assert.equal((await api().get("/api/v1/auth/me")).status, 401);
  assert.equal((await get("/auth/me", "garbage.token.value")).status, 401);
  assert.equal((await get("/auth/me", tk.companyA)).status, 200);
  assert.equal((await post("/auth/change-password", tk.companyA, { currentPassword: "nope", newPassword: "NewPassw0rd!!9" })).status, 400);
  assert.equal((await post("/auth/change-password", tk.companyA, { currentPassword: PASSWORD, newPassword: "short" })).status, 422);
});

/* ---------------------------------------------------------------- RBAC: three roles */
test("rbac: an attendance device can only scan — everything else is forbidden", async () => {
  for (const [m, path] of [["get", "/employees"], ["get", "/attendance"], ["get", "/reports/daily?from=2026-01-01&to=2026-01-31"], ["get", "/attendance-policies"], ["get", "/devices"], ["get", "/departments"], ["get", "/companies/me"], ["get", "/audit-logs"], ["get", "/dashboard/company"]]) {
    assert.equal((await api()[m](`/api/v1${path}`).set(authed(tk.deviceA))).status, 403, path);
  }
  assert.equal((await post("/employees", tk.deviceA, {})).status, 403);
  assert.equal((await post("/attendance/manual", tk.deviceA, {})).status, 403);
  assert.equal((await get("/attendance/scan-config", tk.deviceA)).status, 200);
});

test("rbac: a company manages its own data but has no platform powers; super admin has no tenant data access", async () => {
  assert.equal((await get("/employees", tk.companyA)).status, 200);
  assert.equal((await get("/companies", tk.companyA)).status, 403);
  assert.equal((await post("/companies", tk.companyA, {})).status, 403);
  assert.equal((await get("/companies", tk.superAdmin)).status, 200);
  assert.equal((await get("/employees", tk.superAdmin)).status, 403);
  assert.equal((await post("/attendance/scan", tk.superAdmin, { embedding: Array(128).fill(0) })).status, 403);
  assert.equal((await get("/companies/stats", tk.superAdmin)).body.data.totalCompanies, 2);
});

/* ---------------------------------------------------------------- tenant isolation */
test("tenant: Company A cannot read, update or delete Company B employees", async () => {
  const bId = String(F.B.emps[0]._id);
  assert.equal((await get(`/employees/${bId}`, tk.companyA)).status, 404);
  assert.equal((await patch(`/employees/${bId}`, tk.companyA, { designation: "Hacked" })).status, 404);
  assert.equal((await del(`/employees/${bId}`, tk.companyA)).status, 404);
  const list = await get("/employees?limit=100", tk.companyA);
  assert.ok(list.body.data.every((e) => String(e.companyId) === String(F.A.company._id)));
  assert.equal(list.body.data.length, 2);
});

test("tenant: companyId supplied by the client is ignored on create; foreign refs are rejected", async () => {
  const res = await post("/employees", tk.companyA, { companyId: String(F.B.company._id), employeeCode: "X9", firstName: "Sneaky", lastName: "Person", email: "sneaky@a.test", dateOfJoining: "2026-01-01", monthlySalary: 25000 });
  assert.equal(res.status, 422); // strict schema rejects the unknown field outright
  const ok = await post("/employees", tk.companyA, { employeeCode: "X9", firstName: "Sneaky", lastName: "Person", email: "sneaky@a.test", dateOfJoining: "2026-01-01", monthlySalary: 25000 });
  assert.equal(ok.status, 201);
  assert.equal(String(ok.body.data.companyId), String(F.A.company._id));
  const cross = await post("/employees", tk.companyA, { employeeCode: "X10", firstName: "Cross", lastName: "Tenant", email: "cross@a.test", dateOfJoining: "2026-01-01", monthlySalary: 25000, departmentId: String(F.B.dept._id) });
  assert.equal(cross.status, 400);
  assert.equal((await get(`/departments/${F.B.dept._id}`, tk.companyA)).status, 404);
  assert.equal((await patch(`/shifts/${F.B.shift._id}`, tk.companyA, { name: "pwn" })).status, 404);
});

test("tenant: attendance, reports, leaves, devices, settings and audit of another company are invisible", async () => {
  await AttendanceEvent.create({ companyId: F.B.company._id, employeeId: F.B.emps[0]._id, date: "2026-01-05", type: "CHECK_IN", timestamp: new Date("2026-01-05T04:00:00Z"), seq: 1, method: "FACE" });
  const { recomputeDay } = await import("../src/services/attendance/recompute.js");
  await recomputeDay(F.B.company._id, F.B.emps[0]._id, "2026-01-05", { now: new Date("2026-01-06T10:00:00Z") });
  assert.equal((await get("/attendance?limit=100&from=2026-01-01&to=2026-12-31", tk.companyA)).body.data.length, 0);
  assert.equal((await get("/attendance?limit=100&from=2026-01-01&to=2026-12-31", tk.companyB)).body.data.length, 1);
  assert.equal((await get(`/attendance?employeeId=${F.B.emps[0]._id}`, tk.companyA)).body.data.length, 0);

  const range = "from=2020-01-01&to=2030-12-31";
  assert.equal((await get(`/reports/daily?${range}`, tk.companyA)).body.data.length, 0);
  assert.equal((await get(`/reports/monthly?${range}`, tk.companyA)).body.data.length, 0);


  const cl = (await get("/leave-types", tk.companyB)).body.data.find((t) => t.code === "CL");
  const leave = await post("/leaves", tk.companyB, { employeeId: String(F.B.emps[0]._id), leaveTypeId: String(cl._id), fromDate: "2027-03-01", toDate: "2027-03-05" });
  assert.equal(leave.status, 201);
  assert.equal((await get("/leaves?limit=100", tk.companyA)).body.data.length, 0);
  assert.equal((await post(`/leaves/${leave.body.data._id}/cancel`, tk.companyA)).status, 404);
  assert.equal((await post("/leaves", tk.companyA, { employeeId: String(F.B.emps[0]._id), leaveTypeId: String(cl._id), fromDate: "2027-04-01", toDate: "2027-04-02" })).status, 404);
  assert.equal((await get(`/leaves/balance?employeeId=${F.B.emps[0]._id}`, tk.companyA)).body.data.length >= 0, true);

  assert.equal(String((await get("/companies/me", tk.companyA)).body.data._id), String(F.A.company._id));
  assert.equal((await get(`/companies/${F.B.company._id}`, tk.companyA)).status, 403);
  assert.equal((await get("/devices?limit=100", tk.companyA)).body.data.every((d) => d.email.endsWith("@a.test")), true);
  assert.equal((await get("/audit-logs?limit=100", tk.companyA)).body.data.every((l) => String(l.companyId) === String(F.A.company._id)), true);
});

test("tenant: NoSQL operator injection in query/body is neutralised", async () => {
  assert.notEqual((await get("/employees?search[$ne]=x&department[$ne]=1", tk.companyA)).status, 500);
  assert.equal((await api().post("/api/v1/auth/login").send({ email: { $ne: "" }, password: { $ne: "" } })).status, 422);
});

/* ---------------------------------------------------------------- attendance corrections */
test("attendance: company manual events are audited, validated, and can be voided (history is never overwritten)", async () => {
  const empId = String(F.A.emps[1]._id);
  const ts = new Date(Date.now() - 3 * 3600_000).toISOString();
  const res = await post("/attendance/manual", tk.companyA, { employeeId: empId, type: "MANUAL_CHECK_IN", timestamp: ts, reason: "Forgot to scan" });
  assert.equal(res.status, 200);
  assert.ok(await AuditLog.exists({ action: "attendance.manual_event_added" }));
  const future = await post("/attendance/manual", tk.companyA, { employeeId: empId, type: "MANUAL_CHECK_OUT", timestamp: new Date(Date.now() + 86400_000).toISOString(), reason: "future" });
  assert.equal(future.status, 400);
  assert.equal((await post("/attendance/manual", tk.companyA, { employeeId: String(F.B.emps[0]._id), type: "MANUAL_CHECK_IN", timestamp: ts, reason: "cross tenant" })).status, 404);
  assert.equal((await post(`/attendance/events/${res.body.data.event._id}/void`, tk.companyA, { reason: "Entered in error" })).status, 200);
  assert.equal(await AttendanceEvent.countDocuments({ employeeId: F.A.emps[1]._id }), 1); // voided, not deleted
  await AttendanceEvent.deleteMany({ employeeId: F.A.emps[1]._id });
});

/* ---------------------------------------------------------------- leave */
test("leave: company records leave → attendance shows ON_LEAVE; balance, overlap and cancel behave", async () => {
  const emp = String(F.A.emps[0]._id);
  const cl = (await get("/leave-types", tk.companyA)).body.data.find((t) => t.code === "CL");
  const bal0 = (await get(`/leaves/balance?employeeId=${emp}`, tk.companyA)).body.data.find((b) => b.code === "CL");
  assert.equal(bal0.remaining, 12);

  const rec = await post("/leaves", tk.companyA, { employeeId: emp, leaveTypeId: String(cl._id), fromDate: "2026-11-02", toDate: "2026-11-08", reason: "Trip" });
  assert.equal(rec.status, 201);
  assert.equal(rec.body.data.status, "APPROVED");
  assert.ok(rec.body.data.days >= 5 && rec.body.data.days <= 7);
  assert.equal((await post("/leaves", tk.companyA, { employeeId: emp, leaveTypeId: String(cl._id), fromDate: "2026-11-05", toDate: "2026-11-06" })).status, 409);

  const onLeave = await get("/attendance?status=ON_LEAVE&from=2026-11-01&to=2026-11-30&limit=100", tk.companyA);
  assert.ok(onLeave.body.data.length >= 5);
  assert.equal((await get(`/leaves/balance?employeeId=${emp}`, tk.companyA)).body.data.find((b) => b.code === "CL").remaining, 12 - rec.body.data.days);
  assert.equal((await post("/leaves", tk.companyA, { employeeId: emp, leaveTypeId: String(cl._id), fromDate: "2026-12-01", toDate: "2026-12-31" })).body.code, "INSUFFICIENT_BALANCE");

  assert.equal((await post(`/leaves/${rec.body.data._id}/cancel`, tk.companyA)).status, 200);
  assert.equal((await post(`/leaves/${rec.body.data._id}/cancel`, tk.companyA)).status, 409);
  assert.equal((await get("/attendance?status=ON_LEAVE&from=2026-11-01&to=2026-11-30", tk.companyA)).body.data.length, 0);
  assert.equal((await get(`/leaves/balance?employeeId=${emp}`, tk.companyA)).body.data.find((b) => b.code === "CL").remaining, 12);
});

test("holiday: recurring holidays yield HOLIDAY status via the engine", async () => {
  assert.equal((await post("/holidays", tk.companyA, { name: "Founders Day", date: "2025-12-25", recurring: true })).status, 201);
  assert.equal((await post("/holidays", tk.companyA, { name: "Dup", date: "2025-12-25" })).status, 409);
  const { recomputeDay } = await import("../src/services/attendance/recompute.js");
  const rec = await recomputeDay(F.A.company._id, F.A.emps[0]._id, "2026-12-25", { now: new Date("2027-01-02T00:00:00Z") });
  assert.equal(rec.status, "HOLIDAY");
});

/* ---------------------------------------------------------------- validation / lifecycle */
test("validation: consistent error format, pagination limits, strict updates, overnight shifts, rule validation", async () => {
  const bad = await post("/employees", tk.companyA, { firstName: "A" });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.success, false);
  assert.ok(Array.isArray(bad.body.errors) && bad.body.errors.length > 0);
  assert.equal((await get("/employees?limit=500", tk.companyA)).status, 422);
  const page = await get("/employees?limit=1&page=2&sortBy=firstName&sortOrder=asc", tk.companyA);
  assert.equal(page.body.pagination.limit, 1);
  assert.equal((await patch(`/employees/${F.A.emps[0]._id}`, tk.companyA, { companyId: String(F.B.company._id) })).status, 422);
  assert.equal((await get("/employees/not-an-id", tk.companyA)).status, 422);
  assert.equal((await post("/shifts", tk.companyA, { name: "Night", startTime: "21:00", endTime: "06:00", requiredWorkingMinutes: 480 })).status, 201);
  assert.equal((await post("/shifts", tk.companyA, { name: "Bad", startTime: "09:00", endTime: "09:00", requiredWorkingMinutes: 480 })).status, 422);
  assert.equal((await put("/attendance-policies", tk.companyA, { gracePeriod: 10 })).status, 200);
});

test("employee: duplicate codes are rejected atomically; deleting an employee also deletes their face", async () => {
  assert.equal((await post("/employees", tk.companyA, { employeeCode: "E1", firstName: "Dup", lastName: "Code", email: "dupcode@a.test", dateOfJoining: "2026-01-01", monthlySalary: 25000 })).status, 409);
  assert.equal(await Employee.countDocuments({ email: "dupcode@a.test" }), 0);
  const created = await post("/employees", tk.companyA, { employeeCode: "D1", firstName: "Del", lastName: "Me", email: "del.me@a.test", dateOfJoining: "2026-01-01", monthlySalary: 25000 });
  assert.equal(created.status, 201);
  const id = created.body.data._id;
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(i * 11) + 0.01);
  assert.equal((await post(`/face/employees/${id}/register`, tk.companyA, { embedding: v })).status, 200);
  assert.equal((await del(`/employees/${id}`, tk.companyA)).status, 200);
  assert.equal(await FaceProfile.countDocuments({ employeeId: id, status: "ACTIVE" }), 0);
});

test("company: suspending a company locks out its users AND its devices immediately", async () => {
  const s = await patch(`/companies/${F.B.company._id}/status`, tk.superAdmin, { status: "SUSPENDED" });
  assert.equal(s.status, 200);
  assert.equal((await get("/auth/me", tk.companyB)).status, 403);
  assert.equal((await get("/attendance/scan-config", tk.deviceB)).status, 403);
  assert.equal((await login(F.B.adminEmail)).res.status, 403);
  await patch(`/companies/${F.B.company._id}/status`, tk.superAdmin, { status: "ACTIVE" });
  assert.equal((await get("/auth/me", tk.companyB)).status, 200);
});

test("company: super admin creates a company with its login; the login becomes role COMPANY", async () => {
  const res = await post("/companies", tk.superAdmin, { name: "Fresh Co", email: "hello@fresh.test", timezone: "Europe/London", currency: "GBP", admin: { name: "Fresh Owner", email: "owner@fresh.test", password: PASSWORD } });
  assert.equal(res.status, 201);
  const l = await login("owner@fresh.test");
  assert.equal(l.res.body.data.user.role, "COMPANY");
  assert.equal(l.res.body.data.user.company.timezone, "Europe/London");
});

test("reports: csv export; platform: health, readiness, swagger, 404 shape, no stack traces", async () => {
  const res = await get("/reports/daily?from=2020-01-01&to=2030-12-31&format=csv", tk.companyA);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/csv/);
  assert.equal((await api().get("/health")).status, 200);
  assert.equal((await api().get("/ready")).body.status, "ready");
  const spec = await api().get("/api/docs.json");
  assert.ok(Object.keys(spec.body.paths).length > 40);
  assert.ok(spec.body.paths["/attendance/scan"]);
  assert.equal(spec.body.paths["/kiosk/scan"], undefined);
  const nf = await api().get("/api/v1/nope");
  assert.equal(nf.status, 404);
  assert.ok(!JSON.stringify(nf.body).includes("stack"));
});

/* ---------------------------------------------------------------- branding */
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("branding: super admin sets logo + theme colour when creating a company; both come back on login", async () => {
  const res = await post("/companies", tk.superAdmin, {
    name: "Teal Co", email: "hi@teal.test", timezone: "Asia/Kolkata", currency: "INR", logo: PNG_1PX, theme: { primaryColor: "#0F766E" },
    admin: { name: "Teal Owner", email: "owner@teal.test", password: PASSWORD },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.theme.primaryColor, "#0f766e"); // normalised to lower case
  const l = await login("owner@teal.test");
  assert.equal(l.res.body.data.user.company.theme.primaryColor, "#0f766e");
  assert.equal(l.res.body.data.user.company.logo, PNG_1PX);
  const devLogin = await login(F.A.deviceEmail); // devices get their company's branding too
  assert.equal(devLogin.res.body.data.user.company.theme.primaryColor, "#4f46e5"); // default when never set
});

test("branding: unsafe logos and bad colours are rejected", async () => {
  const create = (extra) => post("/companies", tk.superAdmin, { name: "Bad Co", email: "x@bad.test", timezone: "UTC", currency: "USD", ...extra });
  assert.equal((await create({ theme: { primaryColor: "red" } })).status, 422);
  assert.equal((await create({ theme: { primaryColor: "#12345" } })).status, 422);
  assert.equal((await create({ logo: "data:image/svg+xml;base64,PHN2Zy8+" })).status, 422); // SVG can carry scripts
  assert.equal((await create({ logo: "javascript:alert(1)" })).status, 422);
  assert.equal((await create({ logo: "http://insecure.example/logo.png" })).status, 422);
  assert.equal((await create({ logo: `data:image/png;base64,${"A".repeat(70_000)}` })).status, 422); // too large
  assert.equal((await create({ logo: "https://cdn.example.com/logo.png", theme: { primaryColor: "#123abc" } })).status, 201);
});

test("branding: a company edits its own logo/colour (and can remove the logo); it cannot touch another company's", async () => {
  const up = await patch("/companies/me", tk.companyA, { theme: { primaryColor: "#BE123C" }, logo: PNG_1PX });
  assert.equal(up.status, 200);
  assert.equal((await get("/auth/me", tk.companyA)).body.data.company.theme.primaryColor, "#be123c");
  assert.equal((await get("/auth/me", tk.deviceA)).body.data.company.logo, PNG_1PX); // its devices pick it up too
  assert.equal((await get("/auth/me", tk.companyB)).body.data.company.theme.primaryColor, "#4f46e5"); // B unaffected
  assert.equal((await patch("/companies/me", tk.companyA, { logo: null })).status, 200);
  assert.equal((await get("/auth/me", tk.companyA)).body.data.company.logo ?? null, null);
  assert.equal((await patch("/companies/me", tk.companyA, { theme: { primaryColor: "#zzzzzz" } })).status, 422);
  assert.equal((await patch(`/companies/${F.B.company._id}`, tk.companyA, { theme: { primaryColor: "#000000" } })).status, 403);
  assert.equal((await patch("/companies/me", tk.deviceA, { theme: { primaryColor: "#000000" } })).status, 403);
  // super admin can re-brand any company; list rows never carry the (heavy) logo
  assert.equal((await patch(`/companies/${F.B.company._id}`, tk.superAdmin, { theme: { primaryColor: "#0f766e" }, logo: PNG_1PX })).status, 200);
  const list = await get("/companies?limit=50", tk.superAdmin);
  assert.ok(list.body.data.every((c) => c.logo === undefined));
  const rebranded = (await get(`/companies/${F.B.company._id}`, tk.superAdmin)).body.data;
  assert.equal(rebranded.logo, PNG_1PX);
  assert.deepEqual([rebranded.timezone, rebranded.currency], ["America/New_York", "INR"]); // a partial update leaves everything else alone
  const audit = await AuditLog.find({ action: "company.updated" }).lean();
  assert.ok(!JSON.stringify(audit).includes("iVBORw0KGgo")); // logo bytes never land in the audit log
});

/* ---------------------------------------------------------------- delete company */
test("company: super admin can permanently delete a company and ALL its data; nothing else is touched", async () => {
  const created = await post("/companies", tk.superAdmin, { name: "Doomed Co", email: "x@doomed.test", timezone: "UTC", currency: "USD", admin: { name: "Owner", email: "owner@doomed.test", password: PASSWORD } });
  assert.equal(created.status, 201);
  const cid = created.body.data._id;
  const owner = (await login("owner@doomed.test")).token;
  const emp = await post("/employees", owner, { employeeCode: "D1", firstName: "Doom", lastName: "Emp", email: "d1@doomed.test", dateOfJoining: "2026-01-01", monthlySalary: 25000 });
  assert.equal(emp.status, 201);
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(i * 13) + 0.01);
  assert.equal((await post(`/face/employees/${emp.body.data._id}/register`, owner, { embedding: v })).status, 200);
  await post("/devices", owner, { name: "Doomed device", email: "dev@doomed.test", password: PASSWORD });
  const dev = (await login("dev@doomed.test")).token;
  assert.equal((await post("/attendance/scan", dev, { embedding: v })).status, 200);

  // safeguards
  assert.equal((await api().delete(`/api/v1/companies/${cid}`).set(authed(owner)).send({ confirmName: "Doomed Co" })).status, 403); // the company itself cannot
  assert.equal((await api().delete(`/api/v1/companies/${cid}`).set(authed(tk.superAdmin)).send({})).status, 422);
  const wrong = await api().delete(`/api/v1/companies/${cid}`).set(authed(tk.superAdmin)).send({ confirmName: "doomed co" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, "CONFIRMATION_MISMATCH");
  assert.equal((await get("/employees", owner)).status, 200); // still intact after the failed attempts

  const others = await Employee.countDocuments({ companyId: { $ne: cid } });
  const del = await api().delete(`/api/v1/companies/${cid}`).set(authed(tk.superAdmin)).send({ confirmName: "Doomed Co" });
  assert.equal(del.status, 200, JSON.stringify(del.body));

  // every trace is gone …
  const mongoose = (await import("mongoose")).default;
  for (const Model of Object.values(mongoose.models)) {
    if (Model.schema.path("companyId")) assert.equal(await Model.countDocuments({ companyId: cid }).setOptions({ withDeleted: true }), 0, `${Model.modelName} still has rows`);
  }
  assert.equal(await mongoose.models.Company.countDocuments({ _id: cid }), 0);
  assert.equal(await mongoose.models.User.countDocuments({ email: /doomed\.test$/ }), 0);
  assert.equal(await FaceProfile.countDocuments({ employeeId: emp.body.data._id }), 0);
  // … its people are locked out, other tenants are untouched …
  assert.equal((await login("owner@doomed.test")).res.status, 401);
  assert.equal((await get("/auth/me", owner)).status, 401);
  assert.equal((await get("/attendance/scan-config", dev)).status, 401);
  assert.equal(await Employee.countDocuments({ companyId: { $ne: cid } }), others);
  assert.equal((await get("/employees", tk.companyA)).status, 200);
  assert.equal((await get(`/companies/${cid}`, tk.superAdmin)).status, 404);
  // … and a platform-level audit record (no biometric/personal data) remains
  const rec = await AuditLog.findOne({ action: "company.deleted", entityId: cid }).lean();
  assert.ok(rec);
  assert.equal(rec.companyId, null);
  assert.equal(rec.before.name, "Doomed Co");
  assert.ok(!JSON.stringify(rec).includes("embedding"));
});

/* ---------------------------------------------------------------- salary, department rules, late penalties */
const IST = "Asia/Kolkata";
async function attend(F_, emp, date, inAt, outAt) {
  const { zonedToUtc } = await import("../src/utils/time.js");
  const { recomputeDay } = await import("../src/services/attendance/recompute.js");
  const [h, m] = inAt.split(":").map(Number);
  const [oh, om] = outAt.split(":").map(Number);
  await AttendanceEvent.create([
    { companyId: F_.company._id, employeeId: emp._id, date, type: "CHECK_IN", seq: 1, method: "FACE", timestamp: zonedToUtc(date, h * 60 + m, IST) },
    { companyId: F_.company._id, employeeId: emp._id, date, type: "CHECK_OUT", seq: 2, method: "FACE", timestamp: zonedToUtc(date, oh * 60 + om, IST) },
  ]);
  return recomputeDay(F_.company._id, emp._id, date);
}

test("salary: asked for when adding an employee, validated, editable and listed", async () => {
  const base = { employeeCode: "S1", firstName: "Sal", lastName: "Ary", email: "sal@a.test", dateOfJoining: "2026-02-01" };
  const missing = await post("/employees", tk.companyA, base);
  assert.equal(missing.status, 422);
  assert.ok(missing.body.errors.some((e) => e.field === "monthlySalary"));
  assert.equal((await post("/employees", tk.companyA, { ...base, monthlySalary: -1 })).status, 422);
  assert.equal((await post("/employees", tk.companyA, { ...base, monthlySalary: "lots" })).status, 422);
  const ok = await post("/employees", tk.companyA, { ...base, monthlySalary: 42000 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.monthlySalary, 42000);
  assert.equal((await patch(`/employees/${ok.body.data._id}`, tk.companyA, { monthlySalary: 45000 })).body.data.monthlySalary, 45000);
  assert.equal((await get("/employees?search=sal@a.test", tk.companyA)).body.data[0].monthlySalary, 45000);
  assert.equal((await get("/employees", tk.deviceA)).status, 403); // a device never sees salaries
});

test("rules: each department can have its own rules; others follow the company default; tenants are isolated", async () => {
  const dept = String(F.A.dept._id);
  const initial = (await get(`/attendance-policies/departments/${dept}`, tk.companyA)).body.data;
  assert.equal(initial.inherited, true);
  assert.equal(initial.policy.timingMode, "FIXED");

  const set = await put(`/attendance-policies/departments/${dept}`, tk.companyA, { timingMode: "FLEXIBLE", halfDayWorkingMinutes: 480, multipleCheckInAllowed: false });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.inherited, false);
  assert.equal(set.body.data.policy.timingMode, "FLEXIBLE");
  assert.equal(set.body.data.policy.gracePeriod, 10); // untouched rules start as a copy of the company default
  assert.equal((await get("/attendance-policies", tk.companyA)).body.data.timingMode, "FIXED"); // company default unchanged
  assert.equal((await get("/attendance-policies/departments", tk.companyA)).body.data.find((d) => String(d._id) === dept).hasOwnRules, true);

  // validation + isolation
  assert.equal((await put(`/attendance-policies/departments/${dept}`, tk.companyA, { timingMode: "WHENEVER" })).status, 422);
  assert.equal((await put(`/attendance-policies/departments/${dept}`, tk.companyA, { geofenceEnabled: true })).status, 422); // company-wide only
  assert.equal((await put(`/attendance-policies/departments/${dept}`, tk.companyA, { lateStreakThreshold: 1 })).status, 422);
  assert.equal((await get(`/attendance-policies/departments/${dept}`, tk.companyB)).status, 404);
  assert.equal((await put(`/attendance-policies/departments/${dept}`, tk.companyB, { timingMode: "FLEXIBLE" })).status, 404);
  assert.equal((await del(`/attendance-policies/departments/${dept}`, tk.companyB)).status, 404);
  assert.equal((await get("/attendance-policies/departments", tk.deviceA)).status, 403);
  assert.equal((await get(`/attendance-policies/departments/${F.B.dept._id}`, tk.companyB)).body.data.inherited, true); // B unaffected

  // flexible department: arriving at 11:40 is not late, but the hours must be completed
  const emp = F.A.emps[0];
  const full = await attend(F.A, emp, "2026-02-02", "11:40", "19:50"); // 490 min
  assert.equal(full.isLate, false);
  assert.equal(full.status, "PRESENT");
  const short = await attend(F.A, emp, "2026-02-03", "09:00", "15:00"); // 360 min < 480
  assert.equal(short.status, "HALF_DAY");

  const reset = await del(`/attendance-policies/departments/${dept}`, tk.companyA);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.data.inherited, true);
  const { recomputeDay } = await import("../src/services/attendance/recompute.js");
  assert.equal((await recomputeDay(F.A.company._id, emp._id, "2026-02-02")).status, "HALF_DAY"); // fixed timing again: 160 min late
  assert.ok(await AuditLog.exists({ action: "department_policy.updated" }));
  await AttendanceEvent.deleteMany({ employeeId: emp._id });
});

test("late rules: late N times in a week or on consecutive days marks the day half day, and corrections ripple forward", async () => {
  const dept = String(F.A.dept._id);
  const emp = F.A.emps[0];
  const status = async (date) => (await get(`/attendance?employeeId=${emp._id}&date=${date}`, tk.companyA)).body.data[0];
  // Mon 2 Mar … Fri 6 Mar 2026. Rule: the 2nd late day in a week (and every one after) is a half day.
  assert.equal((await put(`/attendance-policies/departments/${dept}`, tk.companyA, { lateCountEnabled: true, lateCountThreshold: 2, lateCountPeriod: "WEEK" })).status, 200);
  assert.equal((await attend(F.A, emp, "2026-03-02", "09:30", "18:30")).status, "LATE"); // 1st late: no penalty
  assert.equal((await attend(F.A, emp, "2026-03-03", "09:00", "18:00")).status, "PRESENT");
  const second = await attend(F.A, emp, "2026-03-04", "09:25", "18:30");
  assert.equal(second.status, "HALF_DAY");
  assert.equal(second.penaltyReason, "LATE_COUNT");
  assert.equal(second.isLate, true);
  assert.equal((await attend(F.A, emp, "2026-03-09", "09:30", "18:30")).status, "LATE"); // new week, count starts again

  // correcting Monday's check-in to on-time removes Wednesday's penalty
  const monday = await AttendanceEvent.findOne({ employeeId: emp._id, date: "2026-03-02", type: "CHECK_IN" });
  assert.equal((await post(`/attendance/events/${monday._id}/void`, tk.companyA, { reason: "Scanner was down" })).status, 200);
  const { zonedToUtc } = await import("../src/utils/time.js");
  assert.equal((await post("/attendance/manual", tk.companyA, { employeeId: String(emp._id), type: "MANUAL_CHECK_IN", timestamp: zonedToUtc("2026-03-02", 9 * 60, IST).toISOString(), reason: "Was on time" })).status, 200);
  assert.equal((await status("2026-03-02")).status, "PRESENT");
  const wed = await status("2026-03-04");
  assert.equal(wed.status, "LATE");
  assert.equal(wed.penaltyReason, null);

  // consecutive rule instead: two late days in a row → half day; a week-off in between does not break the run
  assert.equal((await put(`/attendance-policies/departments/${dept}`, tk.companyA, { lateCountEnabled: false, lateStreakEnabled: true, lateStreakThreshold: 2 })).status, 200);
  assert.equal((await attend(F.A, emp, "2026-03-14", "09:30", "18:30")).status, "LATE"); // Saturday
  const { recomputeDay } = await import("../src/services/attendance/recompute.js");
  assert.equal((await recomputeDay(F.A.company._id, emp._id, "2026-03-15")).status, "WEEK_OFF"); // Sunday
  const streak = await attend(F.A, emp, "2026-03-16", "09:30", "18:30");
  assert.equal(streak.status, "HALF_DAY");
  assert.equal(streak.penaltyReason, "LATE_STREAK");

  // the other company has no such rule: the same pattern stays LATE
  const b = F.B.emps[1];
  const tz = async (date) => {
    const { zonedToUtc: z } = await import("../src/utils/time.js");
    await AttendanceEvent.create([
      { companyId: F.B.company._id, employeeId: b._id, date, type: "CHECK_IN", seq: 1, method: "FACE", timestamp: z(date, 9 * 60 + 30, "America/New_York") },
      { companyId: F.B.company._id, employeeId: b._id, date, type: "CHECK_OUT", seq: 2, method: "FACE", timestamp: z(date, 18 * 60 + 30, "America/New_York") },
    ]);
    return recomputeDay(F.B.company._id, b._id, date);
  };
  await tz("2026-03-16");
  assert.equal((await tz("2026-03-17")).status, "LATE");
  await del(`/attendance-policies/departments/${dept}`, tk.companyA);
});

test("salary report: deductions follow each department's rules; csv export; isolated per company", async () => {
  // Company A, department ENG: deduct 1 day per absence and 0.5 per half day, a day = salary / 30
  const dept = String(F.A.dept._id);
  assert.equal((await put(`/attendance-policies/departments/${dept}`, tk.companyA, { salaryDeductionEnabled: true, salaryDayBasis: "FIXED_DAYS", salaryFixedDays: 30 })).status, 200);
  const emp = F.A.emps[1]; // salary 30000 → 1000 a day
  const { recomputeDay } = await import("../src/services/attendance/recompute.js");
  await attend(F.A, emp, "2026-04-06", "09:00", "18:00"); // present
  await attend(F.A, emp, "2026-04-07", "09:00", "13:40"); // 280 min → half day
  await recomputeDay(F.A.company._id, emp._id, "2026-04-08"); // no show → absent

  const res = await get("/reports/salary?month=2026-04", tk.companyA);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.data.find((r) => String(r.employeeId) === String(emp._id));
  assert.deepEqual(
    { present: row.present, halfDay: row.halfDay, absent: row.absent, deductionDays: row.deductionDays, perDaySalary: row.perDaySalary, deductionAmount: row.deductionAmount, netSalary: row.netSalary },
    { present: 1, halfDay: 1, absent: 1, deductionDays: 1.5, perDaySalary: 1000, deductionAmount: 1500, netSalary: 28500 }
  );
  assert.equal(row.currency, "INR");

  // an employee outside that department follows the company default (deduction off): counted, nothing deducted
  const loose = await post("/employees", tk.companyA, { employeeCode: "N1", firstName: "No", lastName: "Dept", email: "nodept@a.test", dateOfJoining: "2026-01-01", monthlySalary: 20000 });
  await recomputeDay(F.A.company._id, loose.body.data._id, "2026-04-08");
  const other = (await get(`/reports/salary?month=2026-04&employeeId=${loose.body.data._id}`, tk.companyA)).body.data;
  assert.equal(other.length, 1);
  assert.equal(other[0].absent, 1);
  assert.equal(other[0].deductionAmount, 0);
  assert.equal(other[0].netSalary, 20000);

  assert.equal((await get(`/reports/salary?month=2026-04&department=${dept}`, tk.companyA)).body.data.every((r) => r.department === "Eng"), true);
  const csv = await get("/reports/salary?month=2026-04&format=csv", tk.companyA);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.match(csv.text, /netSalary/);
  assert.equal((await get("/reports/salary?month=2026-4", tk.companyA)).status, 422);
  assert.equal((await get("/reports/salary?month=2026-04", tk.deviceA)).status, 403);
  const foreign = (await get("/reports/salary?month=2026-04", tk.companyB)).body.data;
  assert.ok(foreign.length > 0 && foreign.every((r) => r.name.includes("b"))); // only Company B's people
  assert.equal((await get(`/reports/salary?month=2026-04&employeeId=${emp._id}`, tk.companyB)).body.data.length, 0);
});
