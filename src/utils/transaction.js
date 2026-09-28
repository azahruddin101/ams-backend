import mongoose from "mongoose";
import { logger } from "../config/logger.js";

let supportsTx = null;

async function detect() {
  if (supportsTx !== null) return supportsTx;
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  supportsTx = Boolean(hello.setName || hello.msg === "isdbgrid");
  if (!supportsTx) logger.warn({ msg: "MongoDB is standalone: transactions unavailable, using compensating cleanup" });
  return supportsTx;
}

export const resetTransactionDetection = () => { supportsTx = null; };

/**
 * Runs fn(session). On replica sets/sharded clusters uses a real transaction.
 * On standalone servers session is null; callers must pass `{ session }` only when non-null
 * (use `opts(session)`), and rely on their own compensation.
 */
export async function withTransaction(fn) {
  if (!(await detect())) return fn(null);
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => fn(session));
  } finally {
    await session.endSession();
  }
}

export const opts = (session) => (session ? { session } : {});
