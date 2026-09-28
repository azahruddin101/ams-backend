import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { User } from "./models/index.js";
import { ROLES } from "./constants/index.js";
import { hashPassword } from "./utils/crypto.js";
import { revokeAllForUser } from "./services/token.service.js";
import { SEED_PASSWORD } from "./seed.js";

/**
 * Creates the platform admin login WITHOUT touching any other data (unlike `npm run seed`, which drops the database).
 * Safe to run again: an existing login is left alone unless --reset is passed, which sets its password back and unlocks it.
 *   SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD override the development defaults; production requires both.
 */
const email = (process.env.SUPERADMIN_EMAIL ?? "super@ams.example.com").toLowerCase().trim();
const password = process.env.SUPERADMIN_PASSWORD ?? SEED_PASSWORD;
const reset = process.argv.includes("--reset");

if (env.isProd && !(process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD)) {
  console.error("In production set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD: the development defaults are public.");
  process.exit(1);
}

await connectDatabase();
try {
  const existing = await User.findOne({ email }).select("+passwordHash +failedLoginCount +lockedUntil");
  if (existing && existing.role !== ROLES.SUPER_ADMIN) {
    console.error(`${email} already belongs to a ${existing.role} login. Choose another address with SUPERADMIN_EMAIL.`);
    process.exitCode = 1;
  } else if (existing && !reset) {
    console.log(`Platform admin ${email} already exists (${existing.isActive ? "active" : "DISABLED"}). Nothing changed. Use --reset to set its password again.`);
  } else if (existing) {
    Object.assign(existing, { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), isActive: true, failedLoginCount: 0, lockedUntil: null });
    await existing.save();
    await revokeAllForUser(existing._id);
    console.log(`Platform admin ${email}: password reset, unlocked, other sessions signed out.`);
  } else {
    await User.create({ name: "Platform Admin", email, passwordHash: await hashPassword(password), role: ROLES.SUPER_ADMIN });
    console.log(`Platform admin ${email} created.`);
  }
  const others = await User.countDocuments({ role: ROLES.SUPER_ADMIN, email: { $ne: email } });
  if (others) console.log(`Note: ${others} other platform admin login(s) exist.`);
} finally {
  await disconnectDatabase();
}
