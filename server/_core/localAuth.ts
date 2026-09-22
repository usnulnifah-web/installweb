import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";

const RESET_TTL_MS = 20 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clean(value: string) { return value.trim().toLowerCase(); }
function normalizeAnswer(value: string) { return clean(value).replace(/\s+/g, " "); }
function digest(value: string, salt: string) { return crypto.scryptSync(value, salt, 64).toString("hex"); }
export function hashSecret(value: string) { const salt = crypto.randomBytes(16).toString("hex"); return `${salt}:${digest(value, salt)}`; }
export function verifySecret(value: string, stored: string | null) { if (!stored || !stored.includes(":")) return false; const [salt, expected] = stored.split(":"); const actual = digest(value, salt); return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); }
function hashToken(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }
function publicUser(user: User) { const { passwordHash: _passwordHash, securityAnswerHash: _securityAnswerHash, ...safe } = user; return safe; }
function allowAttempt(key: string, limit: number) { const now = Date.now(); const current = attempts.get(key); if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 60_000 }); return true; } if (current.count >= limit) return false; current.count += 1; return true; }

async function signSession(user: User) {
  if (!ENV.cookieSecret || ENV.cookieSecret.length < 32) throw new Error("JWT_SECRET harus diisi dan minimal 32 karakter.");
  return new SignJWT({ userId: String(user.id), username: user.username || "" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt().setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000)).sign(new TextEncoder().encode(ENV.cookieSecret));
}

export async function setSession(res: Response, req: Request, user: User) { const token = await signSession(user); res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS }); }
export function clearSession(res: Response, req: Request) { res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 }); }

export async function authenticateLocalRequest(req: Request): Promise<User | null> {
  const token = parseCookieHeader(req.headers.cookie ?? "")[COOKIE_NAME];
  if (!token || !ENV.cookieSecret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(ENV.cookieSecret), { algorithms: ["HS256"] });
    const userId = Number(payload.userId);
    if (!Number.isInteger(userId)) return null;
    const user = await db.getUserById(userId);
    if (!user || user.isSuspended) return null;
    return user;
  } catch { return null; }
}

export async function registerLocalUser(input: { username: string; password: string; name: string; email: string; securityQuestion?: string; securityAnswer?: string }, role: "buyer" | "seller" = "buyer") {
  const username = clean(input.username);
  const email = clean(input.email);
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error("Username harus 3–32 karakter dan hanya boleh berisi huruf kecil, angka, atau underscore.");
  if (input.password.length < 15) throw new Error("Password minimal 15 karakter.");
  if (!input.name.trim() || !email.includes("@")) throw new Error("Nama dan email valid wajib diisi.");
  const existing = await db.getUserByUsername(username); if (existing) throw new Error("Username sudah digunakan.");
  const existingEmail = await db.getUserByEmail(email); if (existingEmail) throw new Error("Email sudah digunakan.");
  const answer = input.securityQuestion && input.securityAnswer ? hashSecret(normalizeAnswer(input.securityAnswer)) : null;
  const database = await db.getDb(); if (!database) throw new Error("Database belum siap.");
  const openId = `local_${crypto.randomUUID()}`;
  const result = await database.insert((await import("../../drizzle/schema")).users).values({ openId, username, passwordHash: hashSecret(input.password), securityQuestion: input.securityQuestion?.trim() || null, securityAnswerHash: answer, name: input.name.trim(), email, loginMethod: "password", role });
  return await db.getUserById(Number(result[0].insertId));
}

export async function loginLocalUser(username: string, password: string) {
  const key = `login:${clean(username)}`;
  const user = await db.getUserByUsername(clean(username));
  if (!user || !verifySecret(password, user.passwordHash)) {
    if (!allowAttempt(key, 10)) throw new Error("Terlalu banyak percobaan. Tunggu 60 detik lalu coba lagi.");
    throw new Error("Username atau password salah.");
  }
  if (user.isSuspended) throw new Error("Akun sedang disuspend admin.");
  attempts.delete(key);
  const database = await db.getDb(); if (database) await database.update((await import("../../drizzle/schema")).users).set({ lastSignedIn: new Date() }).where((await import("drizzle-orm")).eq((await import("../../drizzle/schema")).users.id, user.id));
  return user;
}

export async function requestPasswordReset(identifier: string, origin: string) {
  const key = clean(identifier); if (!allowAttempt(`reset:${key}`, 3)) return;
  const user = key.includes("@") ? await db.getUserByEmail(key) : await db.getUserByUsername(key);
  if (!user?.email) return;
  const token = crypto.randomBytes(32).toString("base64url");
  await db.createPasswordResetToken({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  const smtpHost = process.env.SMTP_HOST; const smtpUser = process.env.SMTP_USER; const smtpPass = process.env.SMTP_PASSWORD;
  if (!smtpHost || !smtpUser || !smtpPass) { console.warn("[Auth] SMTP belum dikonfigurasi; reset email tidak dikirim."); return; }
  const transporter = nodemailer.createTransport({ host: smtpHost, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: { user: smtpUser, pass: smtpPass } });
  const url = `${origin.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  await transporter.sendMail({ from: process.env.SMTP_FROM || smtpUser, to: user.email, subject: "Reset password ScriptStore", text: `Gunakan tautan ini dalam 20 menit untuk mengganti password Anda: ${url}` });
}

export async function resetPassword(token: string, password: string) {
  if (password.length < 15) throw new Error("Password minimal 15 karakter.");
  const record = await db.getPasswordResetToken(hashToken(token));
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) throw new Error("Tautan reset tidak valid atau sudah kedaluwarsa.");
  const database = await db.getDb(); if (!database) throw new Error("Database belum siap.");
  const { users } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  await database.update(users).set({ passwordHash: hashSecret(password), loginMethod: "password" }).where(eq(users.id, record.userId));
  await db.consumePasswordResetToken(record.id);
}

export async function resetWithSecurityQuestion(identifier: string, answer: string, password: string) {
  if (password.length < 15) throw new Error("Password minimal 15 karakter.");
  const key = clean(identifier);
  if (!allowAttempt(`security-reset:${key}`, 5)) throw new Error("Terlalu banyak percobaan. Coba lagi nanti.");
  const user = key.includes("@") ? await db.getUserByEmail(key) : await db.getUserByUsername(key);
  if (!user || !user.securityAnswerHash || !verifySecret(normalizeAnswer(answer), user.securityAnswerHash)) throw new Error("Identitas pemulihan tidak cocok.");
  const database = await db.getDb(); if (!database) throw new Error("Database belum siap.");
  const { users } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  await database.update(users).set({ passwordHash: hashSecret(password), loginMethod: "password" }).where(eq(users.id, user.id));
}

export function safeUser(user: User | null) { return user ? publicUser(user) : null; }
