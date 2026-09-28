import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, shutdown, createFixture, api, login, authed, PASSWORD } from "./helpers/fixture.js";
import { AttendanceEvent, FaceVerificationLog, User } from "../src/models/index.js";

let F, companyA, deviceA, companyB, deviceB;
const vec = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(i * seed) + 0.01);
const shifted = (base, delta) => base.map((v, i) => (i === 0 ? v + delta : v)); // Euclidean distance == |delta|

const post = (path, t, body = {}) => api().post(`/api/v1${path}`).set(authed(t)).send(body);
const get = (path, t) => api().get(`/api/v1${path}`).set(authed(t));
const scan = (t, embedding, extra = {}) => post("/attendance/scan", t, { embedding, ...extra });
const enrol = (t, employeeId, embedding) => post(`/face/employees/${employeeId}/register`, t, { embedding });

before(async () => {
  await boot();
  F = await createFixture();
  companyA = (await login(F.A.adminEmail)).token;
  deviceA = (await login(F.A.deviceEmail)).token;
  companyB = (await login(F.B.adminEmail)).token;
  deviceB = (await login(F.B.deviceEmail)).token;
});
after(shutdown);

test("device: a company creates, renames, disables and re-keys attendance devices", async () => {
  const created = await post("/devices", companyA, { name: "Front door", email: "front@a.test", password: PASSWORD });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.role, "ATTENDANCE_DEVICE");
  assert.ok(!JSON.stringify(created.body).includes("passwordHash"));
  assert.equal((await post("/devices", companyA, { name: "Dup", email: "front@a.test", password: PASSWORD })).status, 409);
  assert.equal((await post("/devices", companyA, { name: "Weak", email: "weak@a.test", password: "short" })).status, 422);

  const l = await login("front@a.test");
  assert.equal(l.res.status, 200);
  assert.equal((await get("/attendance/scan-config", l.token)).body.data.deviceName, "Front door");

  const id = created.body.data._id;
  await api().patch(`/api/v1/devices/${id}`).set(authed(companyA)).send({ isActive: false });
  assert.equal((await get("/attendance/scan-config", l.token)).status, 401); // disabled: existing session dies at once
  assert.equal((await login("front@a.test")).res.status, 403);
  await api().patch(`/api/v1/devices/${id}`).set(authed(companyA)).send({ isActive: true, password: "BrandNewPassw0rd!" });
  assert.equal((await login("front@a.test")).res.status, 401); // old password no longer works
  assert.equal((await login("front@a.test", "BrandNewPassw0rd!")).res.status, 200);

  assert.equal((await api().delete(`/api/v1/devices/${id}`).set(authed(companyB))).status, 404); // other tenant cannot touch it
  assert.equal((await api().delete(`/api/v1/devices/${id}`).set(authed(companyA))).status, 200);
  assert.equal(await User.countDocuments({ email: "front@a.test" }), 0);
  assert.equal((await api().patch(`/api/v1/devices/${F.A.emps[0]._id}`).set(authed(companyA)).send({ name: "xx" })).status, 404);
});

test("scan: enrolment rejects duplicate faces; employees need no login", async () => {
  const [e1, e2] = F.A.emps;
  assert.equal((await enrol(companyA, e1._id, vec(1))).status, 200);
  assert.equal((await enrol(companyA, e2._id, vec(3))).status, 200);
  const dup = await enrol(companyA, e2._id, shifted(vec(1), 0.05));
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "FACE_DUPLICATE");
  assert.equal((await enrol(companyA, e1._id, vec(1))).status, 200); // re-enrolling the same person is fine
  assert.equal((await enrol(deviceA, e1._id, vec(1))).status, 403); // devices cannot enrol
  const list = await get("/employees?limit=100", companyA);
  assert.equal(list.body.data.find((e) => e.employeeCode === "E1").faceRegistered, true);
  assert.ok(!JSON.stringify(list.body).includes("embedding"));
  assert.equal(await User.countDocuments({ role: { $nin: ["SUPER_ADMIN", "COMPANY", "ATTENDANCE_DEVICE"] } }), 0);
});

test("scan: identifies the right employee, toggles in/out, applies cooldown", async () => {
  const e1 = F.A.emps[0];
  const inRes = await scan(deviceA, vec(1));
  assert.equal(inRes.status, 200, JSON.stringify(inRes.body));
  assert.equal(inRes.body.data.outcome, "CHECK_IN");
  assert.equal(inRes.body.data.employee.employeeCode, "E1");
  assert.ok(!("email" in inRes.body.data.employee));

  assert.equal((await scan(deviceA, vec(1))).body.data.outcome, "COOLDOWN"); // person still standing there
  assert.equal(await AttendanceEvent.countDocuments({ employeeId: e1._id }), 1);

  await AttendanceEvent.updateMany({ employeeId: e1._id }, { timestamp: new Date(Date.now() - 10 * 60_000) });
  const out = await scan(deviceA, vec(1));
  assert.equal(out.body.data.outcome, "CHECK_OUT");
  const ev = await AttendanceEvent.findOne({ employeeId: e1._id, type: "CHECK_OUT" }).lean();
  assert.equal(ev.method, "FACE");
  assert.ok(ev.deviceUserId);
  assert.ok(ev.metadata.faceScore < 0.05);

  const rec = await get(`/attendance?employeeId=${e1._id}&from=2020-01-01&to=2030-01-01`, companyA);
  assert.equal(rec.body.data[0].sessions.length, 1);
  assert.equal(rec.body.data[0].isOpen, false);

  const other = await scan(deviceA, vec(3)); // a second employee, independently
  assert.equal(other.body.data.employee.employeeCode, "E2");
  assert.equal(other.body.data.outcome, "CHECK_IN");
});

test("scan: a company user may scan too (single-phone setup)", async () => {
  await AttendanceEvent.deleteMany({ employeeId: F.A.emps[1]._id });
  const res = await scan(companyA, vec(3));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.outcome, "CHECK_IN");
});

test("scan: simultaneous scans of one face create exactly one event", async () => {
  await AttendanceEvent.deleteMany({ employeeId: F.A.emps[1]._id });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => scan(deviceA, vec(3))));
  const created = results.filter((r) => r.status === 200 && r.body.data.outcome === "CHECK_IN").length;
  assert.equal(created, 1, results.map((r) => `${r.status}:${r.body.data?.outcome ?? r.body.code}`).join(","));
  assert.equal(await AttendanceEvent.countDocuments({ employeeId: F.A.emps[1]._id }), 1);
});

test("scan: unknown and ambiguous faces never record attendance", async () => {
  const before = await AttendanceEvent.countDocuments({});
  const unknown = await scan(deviceA, vec(9));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "FACE_NOT_RECOGNIZED");

  const base = vec(7);
  const n1 = await post("/employees", companyA, { employeeCode: "N1", firstName: "Near", lastName: "One", email: "n1@a.test", dateOfJoining: "2026-01-01", monthlySalary: 25000 });
  const n2 = await post("/employees", companyA, { employeeCode: "N2", firstName: "Near", lastName: "Two", email: "n2@a.test", dateOfJoining: "2026-01-01", monthlySalary: 25000 });
  assert.equal((await enrol(companyA, n1.body.data._id, base)).status, 200);
  assert.equal((await enrol(companyA, n2.body.data._id, shifted(base, 0.5))).status, 200);
  assert.equal((await scan(deviceA, shifted(base, 0.25))).body.code, "FACE_AMBIGUOUS"); // exactly between two people

  assert.equal(await AttendanceEvent.countDocuments({}), before);
  assert.ok(await FaceVerificationLog.exists({ action: "IDENTIFY", success: false, reason: "NO_MATCH" }));
  assert.equal((await post("/attendance/scan", deviceA, { embedding: [1, 2, 3] })).status, 422);
});

test("scan: geofence is enforced server-side using the company location", async () => {
  await api().patch("/api/v1/companies/me").set(authed(companyA)).send({ settings: { geofence: { latitude: 12.9716, longitude: 77.5946 } } });
  await api().put("/api/v1/attendance-policies").set(authed(companyA)).send({ geofenceEnabled: true, geofenceRadius: 200 });
  assert.equal((await get("/attendance/scan-config", deviceA)).body.data.geofenceEnabled, true);
  await AttendanceEvent.deleteMany({ employeeId: F.A.emps[0]._id });

  assert.equal((await scan(deviceA, vec(1))).body.code, "LOCATION_REQUIRED");
  assert.equal((await scan(deviceA, vec(1), { location: { latitude: 13.05, longitude: 77.6, accuracy: 10 } })).body.code, "OUTSIDE_GEOFENCE");
  assert.equal((await scan(deviceA, vec(1), { location: { latitude: 12.9716, longitude: 77.5946, accuracy: 5000 } })).body.code, "LOCATION_INACCURATE");
  const near = await scan(deviceA, vec(1), { location: { latitude: 12.9717, longitude: 77.5947, accuracy: 15 } });
  assert.equal(near.status, 200);
  const ev = await AttendanceEvent.findOne({ employeeId: F.A.emps[0]._id }).lean();
  assert.ok(ev.location.distanceMeters < 50);
  await api().put("/api/v1/attendance-policies").set(authed(companyA)).send({ geofenceEnabled: false });
});

test("scan: tenant isolation — a device only ever matches its own company's faces", async () => {
  assert.equal((await scan(deviceB, vec(1))).body.code, "FACE_NOT_RECOGNIZED"); // A's employee is a stranger to B
  assert.equal((await enrol(companyB, F.B.emps[0]._id, vec(1))).status, 200); // duplicate check is per company
  const res = await scan(deviceB, vec(1));
  assert.equal(res.body.data.employee.employeeCode, "E1");
  assert.equal(String((await AttendanceEvent.findOne({ employeeId: F.B.emps[0]._id })).companyId), String(F.B.company._id));
  assert.equal((await api().get("/api/v1/devices").set(authed(companyA))).body.data.some((d) => d.email.endsWith("@b.test")), false);
});

test("employee: suspending stops scanning and deletes the face; reactivating needs the face re-registered", async () => {
  const e1 = F.A.emps[0];
  await AttendanceEvent.deleteMany({ employeeId: e1._id });
  assert.equal((await api().patch(`/api/v1/employees/${e1._id}`).set(authed(deviceA)).send({ status: "INACTIVE" })).status, 403); // devices cannot

  assert.equal((await api().patch(`/api/v1/employees/${e1._id}`).set(authed(companyA)).send({ status: "INACTIVE" })).status, 200);
  assert.equal((await scan(deviceA, vec(1))).body.code, "FACE_NOT_RECOGNIZED"); // suspended: no scanning
  const { FaceProfile } = await import("../src/models/index.js");
  assert.equal(await FaceProfile.countDocuments({ employeeId: e1._id, status: "ACTIVE" }), 0); // template gone
  const listed = (await get("/employees?limit=100", companyA)).body.data.find((e) => e.employeeCode === "E1");
  assert.equal(listed.status, "INACTIVE");
  assert.equal(listed.faceRegistered, false);
  assert.equal(await AttendanceEvent.countDocuments({ employeeId: e1._id }), 0); // and nothing was recorded

  assert.equal((await api().patch(`/api/v1/employees/${e1._id}`).set(authed(companyA)).send({ status: "ACTIVE" })).status, 200);
  assert.equal((await scan(deviceA, vec(1))).body.code, "FACE_NOT_RECOGNIZED"); // active again but the face must be re-registered
  assert.equal((await enrol(companyA, e1._id, vec(1))).status, 200);
  const back = await scan(deviceA, vec(1));
  assert.equal(back.status, 200);
  assert.equal(back.body.data.outcome, "CHECK_IN");
});

test("scan: removed/terminated employees are no longer recognised", async () => {
  await AttendanceEvent.deleteMany({ employeeId: F.A.emps[1]._id });
  assert.equal((await scan(deviceA, vec(3))).status, 200); // recognised while active
  await api().delete(`/api/v1/employees/${F.A.emps[1]._id}`).set(authed(companyA));
  assert.equal((await scan(deviceA, vec(3))).body.code, "FACE_NOT_RECOGNIZED");
});
