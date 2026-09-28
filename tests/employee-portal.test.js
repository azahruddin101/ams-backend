import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, shutdown, createFixture, api, login, authed, PASSWORD } from "./helpers/fixture.js";
import { AuditLog, Department, User } from "../src/models/index.js";

let F, companyA, companyB, deviceA;
let hr, hr2, staff, outsider; // employees of company A: two in HR, one in Eng; `outsider` belongs to company B
const tokens = {};

const get = (path, t) => api().get(`/api/v1${path}`).set(authed(t));
const post = (path, t, body = {}) => api().post(`/api/v1${path}`).set(authed(t)).send(body);
const patch = (path, t, body = {}) => api().patch(`/api/v1${path}`).set(authed(t)).send(body);
const del = (path, t) => api().delete(`/api/v1${path}`).set(authed(t));
const person = (code, email, extra = {}) => ({ employeeCode: code, firstName: "Person", lastName: code, email, dateOfJoining: "2026-01-01", monthlySalary: 30000, ...extra });

before(async () => {
  await boot();
  F = await createFixture();
  companyA = (await login(F.A.adminEmail)).token;
  companyB = (await login(F.B.adminEmail)).token;
  deviceA = (await login(F.A.deviceEmail)).token;
});
after(shutdown);

test("department: leave-approval and employee-adding authority are asked for and stored", async () => {
  const plain = await post("/departments", companyA, { name: "Support", code: "SUP" });
  assert.equal(plain.status, 201);
  assert.deepEqual([plain.body.data.canApproveLeave, plain.body.data.canAddEmployees], [false, false]); // off unless granted
  const made = await post("/departments", companyA, { name: "Human Resources", code: "HR", canApproveLeave: true, canAddEmployees: true });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.data.canApproveLeave, made.body.data.canAddEmployees], [true, true]);
  F.A.hrDept = made.body.data;
  assert.equal((await post("/departments", companyA, { name: "Bad", code: "BAD", canApproveLeave: "yes" })).status, 422);
  assert.equal((await patch(`/departments/${made.body.data._id}`, companyB, { canApproveLeave: false })).status, 404);
});

test("employee login: created with a password, signs in as EMPLOYEE, and sees only self-service", async () => {
  const hrDept = String(F.A.hrDept._id);
  const mk = async (code, email, extra) => {
    const res = await post("/employees", companyA, person(code, email, { password: PASSWORD, ...extra }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.hasLogin, true);
    assert.ok(!JSON.stringify(res.body).includes("passwordHash"));
    return res.body.data;
  };
  hr = await mk("H1", "hr1@a.test", { departmentId: hrDept });
  hr2 = await mk("H2", "hr2@a.test", { departmentId: hrDept });
  staff = await mk("S1", "staff@a.test", { departmentId: String(F.A.dept._id) });
  outsider = (await post("/employees", companyB, person("O1", "out@b.test", { password: PASSWORD }))).body.data;
  assert.equal((await post("/employees", companyA, person("W1", "weak@a.test", { password: "short" }))).status, 422);
  assert.equal((await post("/employees", companyA, person("D1", F.A.adminEmail, { password: PASSWORD }))).status, 409); // email already signs in as someone else
  const noLogin = await post("/employees", companyA, person("N1", "nologin@a.test"));
  assert.equal(noLogin.body.data.hasLogin, false); // a login stays optional
  assert.equal((await login("nologin@a.test")).res.status, 401);

  for (const [k, email] of [["hr", "hr1@a.test"], ["hr2", "hr2@a.test"], ["staff", "staff@a.test"], ["outsider", "out@b.test"]]) {
    const l = await login(email);
    assert.equal(l.res.status, 200, email);
    assert.equal(l.res.body.data.user.role, "EMPLOYEE");
    tokens[k] = l.token;
  }
  const me = (await get("/auth/me", tokens.staff)).body.data;
  assert.deepEqual([...me.permissions].sort(), ["leave.apply", "notification.read", "self.read"]);

  const mine = await get("/me", tokens.staff);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.data.employee.employeeCode, "S1");
  assert.equal(mine.body.data.employee.monthlySalary, 30000);
  assert.equal(mine.body.data.employee.departmentId.name, "Eng");
  assert.ok(mine.body.data.rules.timingMode);

  // nothing of the company's is reachable
  for (const path of ["/employees", "/attendance", "/leaves", "/departments", "/attendance-policies", "/reports/salary?month=2026-01", "/audit-logs", "/devices", "/dashboard/company", "/me/approvals"]) {
    assert.equal((await get(path, tokens.staff)).status, 403, path);
  }
  assert.equal((await post("/attendance/scan", tokens.staff, { embedding: Array(128).fill(0.1) })).status, 403);
  assert.equal((await post("/leaves", tokens.staff, {})).status, 403);
  // and self-service is for employee logins only
  assert.equal((await get("/me", companyA)).status, 403);
  assert.equal((await get("/me", deviceA)).status, 403);
});

test("authority: only employees of a department that may add employees can add them, within limits", async () => {
  const perms = (await get("/auth/me", tokens.hr)).body.data.permissions;
  for (const p of ["employee.create", "employee.read", "employee.update", "leave.approve"]) assert.ok(perms.includes(p), p);
  assert.equal(perms.includes("employee.delete"), false);

  assert.equal((await post("/employees", tokens.staff, person("X1", "x1@a.test"))).status, 403);
  const added = await post("/employees", tokens.hr, person("X1", "x1@a.test", { departmentId: String(F.A.dept._id), password: PASSWORD }));
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(String(added.body.data.companyId), String(F.A.company._id));
  assert.equal((await login("x1@a.test")).res.status, 200);
  assert.equal((await get("/departments", tokens.hr)).status, 200); // needed to fill the form
  assert.ok((await get("/employees?limit=100", tokens.hr)).body.data.every((e) => String(e.companyId) === String(F.A.company._id)));

  // limits
  assert.equal((await patch(`/employees/${hr._id}`, tokens.hr, { monthlySalary: 999999 })).status, 403); // not their own record
  assert.equal((await patch(`/employees/${hr2._id}`, tokens.hr, { password: "TakeOver1234!" })).status, 403); // cannot take over a login
  assert.equal((await patch(`/employees/${staff._id}`, tokens.hr, { email: "mine@a.test" })).status, 403);
  assert.equal((await patch(`/employees/${staff._id}`, tokens.hr, { designation: "Engineer" })).status, 200);
  assert.equal((await del(`/employees/${staff._id}`, tokens.hr)).status, 403);
  assert.equal((await patch(`/employees/${outsider._id}`, tokens.hr, { designation: "x" })).status, 404); // other company
  for (const path of ["/attendance-policies", "/reports/salary?month=2026-01", "/devices", "/audit-logs"]) assert.equal((await get(path, tokens.hr)).status, 403, path);

  // the authority follows the department: take it away and it is gone on the next request
  await Department.updateOne({ _id: F.A.hrDept._id }, { canAddEmployees: false });
  assert.equal((await post("/employees", tokens.hr, person("X2", "x2@a.test"))).status, 403);
  assert.equal((await get("/me/approvals", tokens.hr)).status, 200); // approving leave is a separate authority
  await Department.updateOne({ _id: F.A.hrDept._id }, { canAddEmployees: true });
});

test("leave: an employee applies to a chosen approver, who approves or rejects; attendance changes only on approval", async () => {
  const approvers = (await get("/me/leave-approvers", tokens.staff)).body.data;
  assert.deepEqual(approvers.map((a) => a.employeeCode).sort(), ["H1", "H2"]); // everyone in HR who can sign in
  assert.equal(approvers[0].department, "Human Resources");
  assert.deepEqual((await get("/me/leave-approvers", tokens.hr)).body.data.map((a) => a.employeeCode), ["H2"]); // never yourself
  assert.deepEqual((await get("/me/leave-approvers", tokens.outsider)).body.data, []); // company B has no such department

  const types = (await get("/me/leave-types", tokens.staff)).body.data;
  const cl = String(types.find((t) => t.code === "CL")._id);
  const ask = { leaveTypeId: cl, fromDate: "2026-06-01", toDate: "2026-06-02", reason: "Family function" };
  assert.equal((await post("/me/leaves", tokens.staff, ask)).body.code, "APPROVER_REQUIRED");
  assert.equal((await post("/me/leaves", tokens.staff, { ...ask, approverId: String(staff._id) })).body.code, "INVALID_APPROVER");
  assert.equal((await post("/me/leaves", tokens.staff, { ...ask, approverId: String(outsider._id) })).body.code, "INVALID_APPROVER");
  assert.equal((await post("/me/leaves", tokens.staff, { ...ask, approverId: String(hr._id), employeeId: String(hr._id) })).status, 422); // cannot apply as someone else

  const sent = await post("/me/leaves", tokens.staff, { ...ask, approverId: String(hr._id) });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.data.status, "PENDING");
  assert.equal(String(sent.body.data.employeeId), String(staff._id));
  const id = sent.body.data._id;
  assert.equal((await post("/me/leaves", tokens.staff, { ...ask, approverId: String(hr2._id) })).body.code, "LEAVE_OVERLAP");
  assert.equal((await get("/me/leave-balance", tokens.staff)).body.data.find((b) => b.code === "CL").pending, 2);
  assert.equal((await get(`/attendance?employeeId=${staff._id}&status=ON_LEAVE`, companyA)).body.data.length, 0); // nothing counts yet

  // the chosen approver sees it and is told; nobody else can act on it
  const inbox = (await get("/me/approvals?status=PENDING", tokens.hr)).body.data;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].employeeId.employeeCode, "S1");
  assert.equal((await get("/notifications", tokens.hr)).body.data[0].title, "Leave request to approve");
  assert.equal((await get("/me/approvals", tokens.hr2)).body.data.length, 0);
  assert.equal((await post(`/me/approvals/${id}/approve`, tokens.hr2)).status, 404);
  assert.equal((await post(`/me/approvals/${id}/approve`, tokens.staff)).status, 403);
  assert.equal((await post(`/me/approvals/${id}/approve`, tokens.outsider)).status, 403);
  assert.equal((await post(`/leaves/${id}/approve`, companyB)).status, 404);

  const okd = await post(`/me/approvals/${id}/approve`, tokens.hr, { note: "Enjoy" });
  assert.equal(okd.status, 200, JSON.stringify(okd.body));
  assert.equal(okd.body.data.status, "APPROVED");
  assert.equal((await post(`/me/approvals/${id}/reject`, tokens.hr)).status, 409); // already decided
  assert.equal((await get(`/attendance?employeeId=${staff._id}&status=ON_LEAVE&from=2026-06-01&to=2026-06-02`, companyA)).body.data.length, 2);
  assert.equal((await get("/me/leaves", tokens.staff)).body.data[0].status, "APPROVED");
  assert.equal((await get("/notifications", tokens.staff)).body.data[0].title, "Leave approved");
  assert.equal((await post(`/me/leaves/${id}/withdraw`, tokens.staff)).status, 409); // too late to withdraw
  assert.ok(await AuditLog.exists({ action: "leave.approved" }));

  // the reporting employee is kept informed but does not decide
  const opts = (await get("/me/leave-options", tokens.staff)).body.data;
  assert.ok(opts.types.find((t) => t.code === "CL").remaining <= 10);
  assert.deepEqual(opts.weekOffDays, [0]);
  assert.ok(opts.colleagues.some((c) => c.employeeCode === "E1" && c.department === "Eng"));
  assert.equal(opts.colleagues.some((c) => c.employeeCode === "S1" || c.employeeCode === "O1"), false); // not yourself, not another company
  assert.equal(JSON.stringify(opts.colleagues).includes("monthlySalary"), false);
  const lead = (await get("/employees?search=x1@a.test", companyA)).body.data[0]; // has a login, no authority
  const leadToken = (await login("x1@a.test")).token;
  const informed = await post("/me/leaves", tokens.staff, { leaveTypeId: cl, fromDate: "2026-07-01", toDate: "2026-07-01", approverId: String(hr._id), reportingToId: String(lead._id) });
  assert.equal(informed.status, 201, JSON.stringify(informed.body));
  assert.equal(String(informed.body.data.reportingToId), String(lead._id));
  assert.equal((await get("/notifications", leadToken)).body.data[0].title, "Leave request from your team");
  assert.equal((await post(`/me/approvals/${informed.body.data._id}/approve`, leadToken)).status, 403);
  assert.equal((await post(`/me/approvals/${informed.body.data._id}/approve`, tokens.hr)).status, 200);
  assert.equal((await get("/notifications", leadToken)).body.data[0].title, "Team leave approved");
  assert.equal((await get("/me/approvals", tokens.hr)).body.data.find((r) => r._id === informed.body.data._id).reportingToId.departmentId.name, "Eng");
  for (const bad of [String(staff._id), String(outsider._id)]) {
    assert.equal((await post("/me/leaves", tokens.staff, { leaveTypeId: cl, fromDate: "2026-07-08", toDate: "2026-07-08", approverId: String(hr._id), reportingToId: bad })).body.code, "INVALID_REPORTING_EMPLOYEE");
  }

  // separate days picked one by one: 28 and 29 May and 3 June, leaving the days between free
  const picked = await post("/me/leaves", tokens.hr2, { leaveTypeId: cl, dates: ["2026-06-03", "2026-05-28", "2026-05-29", "2026-05-28"], approverId: String(hr._id) });
  assert.equal(picked.status, 201, JSON.stringify(picked.body));
  assert.deepEqual(picked.body.data.dates, ["2026-05-28", "2026-05-29", "2026-06-03"]);
  assert.deepEqual([picked.body.data.fromDate, picked.body.data.toDate, picked.body.data.days], ["2026-05-28", "2026-06-03", 3]);
  assert.equal((await post("/me/leaves", tokens.hr2, { leaveTypeId: cl, dates: ["2026-05-29"], approverId: String(hr._id) })).body.code, "LEAVE_OVERLAP");
  const between = await post("/me/leaves", tokens.hr2, { leaveTypeId: cl, dates: ["2026-06-01"], approverId: String(hr._id) }); // a day in the gap is free
  assert.equal(between.status, 201, JSON.stringify(between.body));
  assert.equal((await post(`/me/leaves/${between.body.data._id}/withdraw`, tokens.hr2)).status, 200);
  assert.equal((await post(`/me/approvals/${picked.body.data._id}/approve`, tokens.hr)).status, 200);
  const marked = (await get(`/attendance?employeeId=${hr2._id}&status=ON_LEAVE&from=2026-05-25&to=2026-06-05&limit=50`, companyA)).body.data.map((r) => r.date).sort();
  assert.deepEqual(marked, ["2026-05-28", "2026-05-29", "2026-06-03"]); // only the picked days, not the ones between
  assert.equal((await post("/me/leaves", tokens.hr2, { leaveTypeId: cl, dates: ["2026-06-07"], approverId: String(hr._id) })).body.code, "NOT_A_WORKING_DAY"); // a Sunday
  assert.equal((await post("/me/leaves", tokens.hr2, { leaveTypeId: cl, dates: ["2026-06-08", "2026-06-09"], isHalfDay: true, approverId: String(hr._id) })).status, 400);
  assert.equal((await post("/me/leaves", tokens.hr2, { leaveTypeId: cl, dates: ["2026-06-08"], fromDate: "2026-06-08", toDate: "2026-06-08", approverId: String(hr._id) })).status, 422);
  assert.equal((await post("/me/leaves", tokens.hr2, { leaveTypeId: cl, dates: [], approverId: String(hr._id) })).status, 422);

  // rejection, withdrawal, and the company deciding
  const second = await post("/me/leaves", tokens.staff, { leaveTypeId: cl, fromDate: "2026-06-10", toDate: "2026-06-10", approverId: String(hr2._id) });
  assert.equal((await post(`/me/approvals/${second.body.data._id}/reject`, tokens.hr2, { note: "Release week" })).body.data.status, "REJECTED");
  assert.equal((await get(`/attendance?employeeId=${staff._id}&date=2026-06-10`, companyA)).body.data.length, 0);
  const third = await post("/me/leaves", tokens.staff, { leaveTypeId: cl, fromDate: "2026-06-10", toDate: "2026-06-10", approverId: String(hr._id) }); // free again after the rejection
  assert.equal(third.status, 201);
  assert.equal((await post(`/me/leaves/${third.body.data._id}/withdraw`, tokens.hr)).status, 404); // only your own
  assert.equal((await post(`/me/leaves/${third.body.data._id}/withdraw`, tokens.staff)).body.data.status, "CANCELLED");
  const fourth = await post("/me/leaves", tokens.hr, { leaveTypeId: cl, fromDate: "2026-06-15", toDate: "2026-06-15", approverId: String(hr2._id) });
  assert.equal((await post(`/leaves/${fourth.body.data._id}/approve`, companyA)).body.data.status, "APPROVED"); // the company can decide any request
  assert.equal((await get("/leaves?status=PENDING", companyA)).body.data.length, 0);

  // with no approving department, the request goes to the company
  const lone = await post("/me/leaves", tokens.outsider, { leaveTypeId: String((await get("/me/leave-types", tokens.outsider)).body.data[0]._id), fromDate: "2026-06-01", toDate: "2026-06-01" });
  assert.equal(lone.status, 201, JSON.stringify(lone.body));
  assert.equal((await get("/notifications", companyB)).body.data[0].title, "Leave request to approve");
  assert.equal((await post(`/leaves/${lone.body.data._id}/reject`, companyB)).status, 200);
  assert.equal((await get("/me/leaves", tokens.outsider)).body.data.length, 1); // each employee sees only their own
});

test("designations: what was typed before is offered next time, per company", async () => {
  const before = (await get("/employees/designations", companyA)).body.data;
  assert.ok(before.includes("Engineer")); // set earlier on an employee
  assert.equal((await post("/employees", companyA, person("G1", "g1@a.test", { designation: "  Growth Lead " }))).status, 201);
  assert.equal((await post("/employees", companyA, person("G2", "g2@a.test", { designation: "growth lead" }))).status, 201); // same title, other spelling
  const gone = await post("/employees", companyA, person("G3", "g3@a.test", { designation: "Archivist" }));
  assert.equal((await del(`/employees/${gone.body.data._id}`, companyA)).status, 200);
  const list = (await get("/employees/designations", companyA)).body.data;
  assert.equal(list.filter((d) => d.toLowerCase() === "growth lead").length, 1);
  assert.ok(list.includes("Archivist")); // kept after the employee left
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  assert.equal((await get("/employees/designations", companyB)).body.data.some((d) => /growth lead|archivist/i.test(d)), false);
  assert.equal((await get("/employees/designations", deviceA)).status, 403);
  assert.equal((await get("/employees/designations", tokens.hr)).status, 200); // needed by employees who add employees
});

test("employee login lifecycle: follows the employee record", async () => {
  // the company resets a password: old sessions and the old password stop working
  assert.equal((await patch(`/employees/${staff._id}`, companyA, { password: "BrandNewPassw0rd!" })).status, 200);
  assert.equal((await get("/me", tokens.staff)).status, 200); // access token is short-lived; the refresh token is what is revoked
  assert.equal((await login("staff@a.test")).res.status, 401);
  assert.equal((await login("staff@a.test", "BrandNewPassw0rd!")).res.status, 200);
  // changing the email moves the login with it
  assert.equal((await patch(`/employees/${staff._id}`, companyA, { email: "staff.new@a.test" })).status, 200);
  assert.equal((await login("staff.new@a.test", "BrandNewPassw0rd!")).res.status, 200);
  assert.equal((await patch(`/employees/${staff._id}`, companyA, { email: "hr1@a.test" })).status, 409);
  // giving a login later
  const late = (await get("/employees?search=nologin@a.test", companyA)).body.data[0];
  assert.equal((await patch(`/employees/${late._id}`, companyA, { password: PASSWORD })).status, 200);
  assert.equal((await login("nologin@a.test")).res.status, 200);
  // suspended → locked out at once; reactivated → back; deleted → login removed
  assert.equal((await patch(`/employees/${staff._id}`, companyA, { status: "INACTIVE" })).status, 200);
  assert.equal((await get("/me", tokens.staff)).status, 401);
  assert.equal((await login("staff.new@a.test", "BrandNewPassw0rd!")).res.status, 403);
  assert.equal((await patch(`/employees/${staff._id}`, companyA, { status: "ACTIVE" })).status, 200);
  assert.equal((await login("staff.new@a.test", "BrandNewPassw0rd!")).res.status, 200);
  assert.equal((await del(`/employees/${staff._id}`, companyA)).status, 200);
  assert.equal(await User.countDocuments({ email: "staff.new@a.test" }), 0);
  assert.equal((await login("staff.new@a.test", "BrandNewPassw0rd!")).res.status, 401);
  assert.deepEqual((await get("/me/leave-approvers", tokens.hr2)).body.data.map((a) => a.employeeCode), ["H1"]);
});
