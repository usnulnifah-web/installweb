import crypto from "node:crypto";
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { setSession } from "./localAuth";
import { isGoogleLoginEnabled } from "./googleLoginSetting";

const GOOGLE_STATE_COOKIE = "google_oauth_state";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    baseUrl: (process.env.APP_BASE_URL ?? "").replace(/\/$/, ""),
  };
}

function redirectUri(req: Request) {
  return `${config().baseUrl || `${req.protocol}://${req.get("host")}`}/api/auth/google/callback`;
}

function cookieOptions(req: Request) {
  const secure = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
  return { ...getSessionCookieOptions(req), httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: secure ? "none" as const : "lax" as const, secure };
}

function googleConfigured() {
  const { clientId, clientSecret } = config();
  return Boolean(clientId && clientSecret);
}

export function registerGoogleAuthRoutes(app: Express) {
  app.get("/api/auth/google", async (req: Request, res: Response) => {
    if (!(await isGoogleLoginEnabled())) {
      res.status(404).send("Login Google sedang dinonaktifkan admin.");
      return;
    }
    if (!googleConfigured()) {
      res.status(503).send("Login Google belum dikonfigurasi. Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET.");
      return;
    }
    const state = crypto.randomBytes(32).toString("base64url");
    res.cookie(GOOGLE_STATE_COOKIE, state, cookieOptions(req));
    const params = new URLSearchParams({ client_id: config().clientId, redirect_uri: redirectUri(req), response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    if (!(await isGoogleLoginEnabled())) {
      res.status(404).send("Login Google sedang dinonaktifkan admin.");
      return;
    }
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const expectedState = parseCookieHeader(req.headers.cookie ?? "")[GOOGLE_STATE_COOKIE];
    res.clearCookie(GOOGLE_STATE_COOKIE, cookieOptions(req));
    if (!state || !code || !expectedState || state.length !== expectedState.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
      res.status(400).send("OAuth state tidak valid.");
      return;
    }
    if (!googleConfigured()) {
      res.status(503).send("Login Google belum dikonfigurasi.");
      return;
    }
    try {
      const token = await axios.post<{ access_token: string }>(GOOGLE_TOKEN_URL, new URLSearchParams({ code, client_id: config().clientId, client_secret: config().clientSecret, redirect_uri: redirectUri(req), grant_type: "authorization_code" }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      const profile = await axios.get<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${token.data.access_token}` } });
      const googleUser = profile.data;
      if (!googleUser.sub || !googleUser.email || googleUser.email_verified !== true) throw new Error("Akun Google harus memiliki email terverifikasi.");
      const openId = `google_${googleUser.sub}`;
      const existing = await db.getUserByOpenId(openId) ?? await db.getUserByEmail(googleUser.email.toLowerCase());
      const database = await db.getDb();
      if (existing && database) {
        await database.update(users).set({ openId, name: googleUser.name || existing.name, email: googleUser.email.toLowerCase(), avatarUrl: googleUser.picture || existing.avatarUrl, loginMethod: "google", lastSignedIn: new Date() }).where(eq(users.id, existing.id));
      } else {
        await db.upsertUser({ openId, name: googleUser.name || null, email: googleUser.email.toLowerCase(), avatarUrl: googleUser.picture || null, loginMethod: "google", lastSignedIn: new Date() });
      }
      const user = await db.getUserByOpenId(openId);
      if (!user) throw new Error("Akun Google gagal disimpan.");
      await setSession(res, req, user);
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Google OAuth] Callback failed", error);
      res.status(502).send("Login Google gagal. Periksa konfigurasi OAuth dan coba lagi.");
    }
  });
}

export { googleConfigured };
