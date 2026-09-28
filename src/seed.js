import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { User, Employee, Department, Shift, AttendancePolicy, Holiday, AttendanceEvent } from "./models/index.js";
import { ROLES, COMPANY_STATUS, EVENT_TYPES, EVENT_METHODS } from "./constants/index.js";
import { hashPassword } from "./utils/crypto.js";
import { dateKeyInTz, addDaysToKey, zonedToUtc } from "./utils/time.js";
import { createCompany } from "./services/company.service.js";
import { recomputeDay, loadEmployeeContext } from "./services/attendance/recompute.js";

// Development-only credentials. Never reuse these anywhere real.
export const SEED_PASSWORD = "DevPassw0rd!2026";
const HISTORY_DAYS = 21;

/** Tiny dependency-free PNG: a rounded colour tile with a white ring — a stand-in logo for demo tenants. */
function makeLogoDataUri(hex, size = 96) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const c = size / 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = Math.max(Math.abs(x - c + 0.5) - (c - 18), 0);
      const dy = Math.max(Math.abs(y - c + 0.5) - (c - 18), 0);
      const inside = dx * dx + dy * dy <= 18 * 18;
      const d = Math.hypot(x - c + 0.5, y - c + 0.5);
      const ring = d > size * 0.2 && d < size * 0.3;
      const o = 1 + x * 4;
      if (inside) { row[o] = ring ? 255 : r; row[o + 1] = ring ? 255 : g; row[o + 2] = ring ? 255 : b; row[o + 3] = 255; }
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

// Deterministic PRNG so seeded data is reproducible.
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

const PEOPLE = {
  A: [["Aarav", "Sharma", "Engineer"], ["Diya", "Patel", "Designer"], ["Kabir", "Singh", "Engineer"], ["Meera", "Nair", "QA Analyst"], ["Rohan", "Gupta", "Support Lead"]],
  B: [["Olivia", "Brown", "Accountant"], ["Liam", "Johnson", "Analyst"], ["Emma", "Davis", "Sales Rep"], ["Noah", "Wilson", "Engineer"], ["Ava", "Moore", "Coordinator"]],
};

async function seedCompany({ key, prefix, name, timezone, currency, color, policy, admin, shifts, salaries }) {
  const ctx = { user: { id: null }, ip: "seed" };
  const company = await createCompany(ctx, {
    name, email: `contact@${key}.example.com`, timezone, currency, status: COMPANY_STATUS.ACTIVE,
    theme: { primaryColor: color }, logo: makeLogoDataUri(color),
    admin: { name: `${name} Admin`, email: admin, password: SEED_PASSWORD },
  });
  const companyId = company._id;
  await AttendancePolicy.updateOne({ companyId }, policy);
  await User.create({ name: `${name} front desk`, email: `device@${key}.example.com`, passwordHash: await hashPassword(SEED_PASSWORD), role: ROLES.ATTENDANCE_DEVICE, companyId });

  const depts = await Department.create([
    { companyId, name: "Engineering", code: "ENG" }, { companyId, name: "Operations", code: "OPS" },
  ]);
  const createdShifts = await Shift.create(shifts.map((s) => ({ ...s, companyId })));
  const employees = [];
  for (const [i, [first, last, designation]] of PEOPLE[prefix].entries()) {
    const emp = await Employee.create({
      companyId, employeeCode: `${prefix}${String(i + 1).padStart(3, "0")}`, firstName: first, lastName: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${key}.example.com`, dateOfJoining: new Date("2025-01-06"),
      departmentId: depts[i % 2]._id, shiftId: createdShifts[i === 4 && createdShifts[1] ? 1 : 0]._id, designation,
      monthlySalary: salaries[i % salaries.length],
    });
    // Employees have no credentials: they identify themselves by face at the kiosk. Enrol faces from Admin → Employees.
    employees.push(emp);
  }
  return { company, employees };
}

async function generateHistory(company, employees) {
  const rand = rng(company.name.length * 7919);
  const tz = company.timezone;
  const today = dateKeyInTz(new Date(), tz);
  for (const emp of employees) {
    const context = await loadEmployeeContext(company._id, emp._id);
    const [sh, sm] = context.shift.startTime.split(":").map(Number);
    const seq = {};
    for (let d = HISTORY_DAYS; d >= 1; d--) {
      const date = addDaysToKey(today, -d);
      const isSunday = context.company.settings.weekOffDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      const roll = rand();
      if (!isSunday && roll < 0.06) { await recomputeDay(company._id, emp._id, date, { context }); continue; } // absent
      const lateBy = roll < 0.3 ? Math.floor(15 + rand() * 50) : Math.floor(rand() * 8) - 3;
      const start = sh * 60 + sm + lateBy;
      const len = 480 + Math.floor(rand() * 90) - 20;
      const events = [];
      if (!isSunday) {
        if (roll > 0.75) { // split day: lunch gap
          events.push([EVENT_TYPES.CHECK_IN, start], [EVENT_TYPES.CHECK_OUT, start + 240], [EVENT_TYPES.CHECK_IN, start + 300], [EVENT_TYPES.CHECK_OUT, start + 300 + len - 240]);
        } else events.push([EVENT_TYPES.CHECK_IN, start], [EVENT_TYPES.CHECK_OUT, start + len]);
      }
      for (const [type, minutes] of events) {
        seq[date] = (seq[date] ?? 0) + 1;
        await AttendanceEvent.create({
          companyId: company._id, employeeId: emp._id, date, type, seq: seq[date], method: EVENT_METHODS.WEB,
          timestamp: zonedToUtc(date, minutes, tz), ipAddress: "seed",
        });
      }
      await recomputeDay(company._id, emp._id, date, { context });
    }
  }
}

export async function seedDatabase() {
  if (env.isProd) throw new Error("Refusing to seed a production database");
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  await User.create({ name: "Platform Admin", email: "super@ams.example.com", passwordHash: await hashPassword(SEED_PASSWORD), role: ROLES.SUPER_ADMIN });

  const a = await seedCompany({
    key: "acme", prefix: "A", name: "Acme Technologies", timezone: "Asia/Kolkata", currency: "INR", color: "#0f766e", admin: "admin@acme.example.com",
    salaries: [60000, 45000, 75000, 40000, 50000],
    // late 3 times in a month → half day from the 3rd; salary is cut for absences and half days
    policy: { gracePeriod: 10, lateCountEnabled: true, lateCountThreshold: 3, lateCountPeriod: "MONTH", salaryDeductionEnabled: true },
    shifts: [
      { name: "General", startTime: "09:00", endTime: "18:00", breakDuration: 60, gracePeriod: 10, requiredWorkingMinutes: 480, allowOvertime: true, overtimeAfterMinutes: 480 },
      { name: "Night", startTime: "21:00", endTime: "06:00", breakDuration: 60, gracePeriod: 10, requiredWorkingMinutes: 480, allowOvertime: true, overtimeAfterMinutes: 480 },
    ],
  });
  const b = await seedCompany({
    key: "globex", prefix: "B", name: "Globex Retail", timezone: "America/New_York", currency: "USD", color: "#be123c", admin: "admin@globex.example.com",
    salaries: [5200, 4800, 4100, 6500, 3900],
    policy: { gracePeriod: 5 },
    shifts: [{ name: "Retail Day", startTime: "08:30", endTime: "17:30", breakDuration: 45, gracePeriod: 5, requiredWorkingMinutes: 480, allowOvertime: true, overtimeAfterMinutes: 480 }],
  });

  const year = new Date().getUTCFullYear();
  await Holiday.create([
    { companyId: a.company._id, name: "Republic Day", date: `${year}-01-26`, recurring: true },
    { companyId: a.company._id, name: "Independence Day", date: `${year}-08-15`, recurring: true },
    { companyId: a.company._id, name: "Gandhi Jayanti", date: `${year}-10-02`, recurring: true },
    { companyId: b.company._id, name: "New Year's Day", date: `${year}-01-01`, recurring: true },
    { companyId: b.company._id, name: "Independence Day", date: `${year}-07-04`, recurring: true },
  ]);

  await generateHistory(a.company, a.employees);
  await generateHistory(b.company, b.employees);
  return { a, b };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await connectDatabase();
  await seedDatabase();
  console.log(`\nSeed complete. All accounts use the dev-only password: ${SEED_PASSWORD}\n`);
  console.log("  super@ams.example.com     SUPER_ADMIN         adds companies");
  console.log("  admin@acme.example.com    COMPANY             Acme Technologies (Asia/Kolkata) — manages employees, rules, analytics");
  console.log("  device@acme.example.com   ATTENDANCE_DEVICE   Acme front desk — can only scan faces");
  console.log("  admin@globex.example.com  COMPANY             Globex Retail (America/New_York)");
  console.log("  device@globex.example.com ATTENDANCE_DEVICE   Globex front desk");
  console.log("  Employees have no logins: enrol their faces under Company → Employees, then scan at the device.\n");
  await disconnectDatabase();
}
