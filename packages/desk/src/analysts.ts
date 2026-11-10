// Analyst login (docs/architecture.md → Admin login). Passwords are hashed with scrypt from
// node:crypto; sessions are random tokens whose SHA-256 alone is stored; failed logins are
// written to the append-only audit log, and too many lock the email and the network out.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import {
  analystForLogin, appendAudit, deleteSession, insertSession, recentFailedLogins, sessionAnalyst, upsertAnalyst, type Analyst, type AnalystRole, type Pool,
} from "@proofofclaim/db";

/** scrypt cost: N × r × 128 bytes = 2^17 × 8 × 128 = 128 MiB of memory per hash. Stored with each hash, so it can rise later. */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

export const SESSION_HOURS = 12;
export const LOCKOUT_MINUTES = 15;
/** Failed attempts allowed in LOCKOUT_MINUTES, per email and per network. */
export const MAX_FAILED_PER_EMAIL = 5;
export const MAX_FAILED_PER_NETWORK = 20;
export const MIN_PASSWORD_LENGTH = 12;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`a password needs at least ${MIN_PASSWORD_LENGTH} characters`);
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [tag, n, r, p, salt, key] = stored.split("$");
  if (tag !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const want = Buffer.from(key, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A hash nobody's password matches, verified against when the email is unknown so timing gives nothing away. */
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashPassword(randomBytes(24).toString("base64url")));

export const tokenHash = (token: string): Buffer => createHash("sha256").update(token).digest();

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export type LoginResult = { ok: true; analyst: Analyst; token: string; expiresAt: Date } | { ok: false; error: string };

/**
 * Checks an email and password. `network` is a keyed hash of the caller's network (never the raw
 * IP), used only to count failures. Every attempt is written to the audit log.
 */
export async function login(pool: Pool, a: { email: string; password: string; network: string | null }): Promise<LoginResult> {
  const email = normalizeEmail(a.email);
  const failed = await recentFailedLogins(pool, { email, network: a.network, minutes: LOCKOUT_MINUTES });
  if (failed.byEmail >= MAX_FAILED_PER_EMAIL || failed.byNetwork >= MAX_FAILED_PER_NETWORK) {
    await appendAudit(pool, { actor: "anonymous", action: "login_locked", subject: email, detail: { network: a.network } });
    return { ok: false, error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.` };
  }
  const found = await analystForLogin(pool, email);
  const ok = await verifyPassword(a.password, found?.passwordHash ?? (await decoyHash()));
  if (!found || !ok) {
    await appendAudit(pool, { actor: "anonymous", action: "login_failed", subject: email, detail: { network: a.network } });
    return { ok: false, error: "That email and password don't match an analyst account." };
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await insertSession(pool, { tokenHash: tokenHash(token), analystId: found.id, expiresAt });
  const analyst: Analyst = { id: found.id, email: found.email, name: found.name, role: found.role };
  await appendAudit(pool, { actor: `analyst:${analyst.email}`, action: "login", subject: analyst.email, detail: { network: a.network } });
  return { ok: true, analyst, token, expiresAt };
}

export async function analystFromToken(pool: Pool, token: string | undefined): Promise<Analyst | null> {
  if (!token || token.length > 128) return null;
  return sessionAnalyst(pool, tokenHash(token));
}

export async function logout(pool: Pool, token: string | undefined): Promise<void> {
  if (!token) return;
  const who = await analystFromToken(pool, token);
  await deleteSession(pool, tokenHash(token));
  if (who) await appendAudit(pool, { actor: `analyst:${who.email}`, action: "logout", subject: who.email, detail: {} });
}

/** Creates an analyst or resets one's password and role. For the seed and `pnpm admin:add`, never a web form. */
export async function setAnalyst(pool: Pool, a: { email: string; name: string; role: AnalystRole; password: string }, by: string): Promise<Analyst> {
  const analyst = await upsertAnalyst(pool, { email: normalizeEmail(a.email), name: a.name.trim(), role: a.role, passwordHash: await hashPassword(a.password) });
  await appendAudit(pool, { actor: by, action: "analyst_set", subject: analyst.email, detail: { role: analyst.role } });
  return analyst;
}
