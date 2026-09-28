import crypto from "node:crypto";
import argon2 from "argon2";
import { env } from "../config/env.js";

export const hashPassword = (plain) => argon2.hash(plain, { type: argon2.argon2id });
export const verifyPassword = async (hash, plain) => {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
};

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

const KEY = Buffer.from(env.BIOMETRIC_ENCRYPTION_KEY, "hex");

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). */
export function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function decryptBuffer(payload) {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}
export const encryptEmbedding = (vec) => encryptBuffer(Buffer.from(new Float32Array(vec).buffer));
export function decryptEmbedding(payload) {
  const b = decryptBuffer(payload);
  return Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
}
