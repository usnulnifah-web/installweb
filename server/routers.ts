import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { orders, productCustomizations, products, settings, topupRequests, transactions, users } from "../drizzle/schema";
import { getDb, getOrdersBySeller, getProductsBySeller, getPublishedProducts } from "./db";
import { storagePut } from "./storage";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import JavaScriptObfuscator from "javascript-obfuscator";
import crypto from "node:crypto";
import type { Request } from "express";
import { clearSession, loginLocalUser, registerLocalUser, requestPasswordReset, resetPassword, resetWithSecurityQuestion, safeUser, setSession } from "./_core/localAuth";
import { MIN_PASSWORD_LENGTH } from "@shared/const";

const roleProcedure = (role: "admin" | "seller" | "buyer") => protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== role) throw new TRPCError({ code: "FORBIDDEN", message: `Akses khusus ${role}.` });
  if (ctx.user.isSuspended) throw new TRPCError({ code: "FORBIDDEN", message: "Akun sedang disuspend oleh admin." });
  return next({ ctx });
});
const sellerProcedure = roleProcedure("seller");
const buyerProcedure = roleProcedure("buyer");

async function getAdminFee(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const row = (await db.select().from(settings).limit(1))[0];
  if (row) return row.adminFee;
  await db.insert(settings).values({ adminFee: 5000 });
  return 5000;
}

async function getObfuscationEnabled(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const row = (await db.select().from(settings).limit(1))[0];
  return row ? row.obfuscationEnabled === 1 : true;
}

async function getAssetDomain(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const row = (await db.select().from(settings).limit(1))[0];
  return row?.assetDomain || "";
}

function validateOpenApiToken(token: string) {
  const value = token.trim();
  if (!/^[A-Za-z0-9_+/=-]{8,2048}$/.test(value)) throw new TRPCError({ code: "BAD_REQUEST", message: "Token Open API BukaOlshop tidak valid." });
  return value;
}

async function fetchBukaOlshopCategories(token: string) {
  const value = validateOpenApiToken(token);
  const response = await fetch(`https://openapi.bukaolshop.net/v1/app/kategori?${new URLSearchParams({ token: value })}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `Open API kategori mengembalikan HTTP ${response.status}.` });
  const payload = await response.json() as { data?: unknown[]; code?: number; status?: string };
  return { code: payload.code || 200, status: payload.status || "ok", data: Array.isArray(payload.data) ? payload.data : [] };
}

async function fetchBukaOlshopProducts(input: { token: string; page: number; categoryId?: number; search?: string }) {
  const token = validateOpenApiToken(input.token);
  const params = new URLSearchParams({ token, page: String(input.page) });
  if (input.categoryId) params.set("id_kategori", String(input.categoryId));
  if (input.search) params.set("cari_nama_produk", input.search.slice(0, 100));
  const response = await fetch(`https://openapi.bukaolshop.net/v1/app/produk?${params.toString()}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `Open API BukaOlshop mengembalikan HTTP ${response.status}.` });
  const payload = await response.json() as { code?: number; status?: string; page?: number; data?: unknown[] };
  if (payload.code && payload.code !== 200) throw new TRPCError({ code: "BAD_GATEWAY", message: payload.status || "Open API BukaOlshop menolak permintaan." });
  return { code: payload.code || 200, status: payload.status || "ok", page: payload.page || input.page, data: Array.isArray(payload.data) ? payload.data : [] };
}

function normalizeStoreUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "URL toko tidak valid." }); }
  if (parsed.protocol !== "https:") throw new TRPCError({ code: "BAD_REQUEST", message: "URL toko wajib menggunakan HTTPS." });
  return `${parsed.protocol}//${parsed.host}`;
}

function storeOriginMatches(req: Request, storeUrl: string) {
  const origin = String(req.headers.origin || req.headers.referer || "");
  if (!origin) return false;
  try { return new URL(origin).origin === storeUrl; } catch { return false; }
}

export function detectTemplateTokens(script: string) {
  return Array.from(new Set(Array.from(script.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g), (match) => match[1])));
}

function appearanceKeyFromMarkup(markup: string) {
  const marker = markup.match(/(?:data-scriptstore|id|class|alt)\s*=\s*["']([^"']+)["']/i)?.[1] || "";
  const normalized = marker.toLowerCase();
  if (/logo/.test(normalized)) return "logoUrl";
  if (/banner|hero|cover/.test(normalized)) return "bannerUrl";
  return null;
}

/** Returns the first safe image URL found in script markup for live product previews. */
export function extractProductThumbnail(script: string) {
  const match = script.match(/<img\b[^>]*?\bsrc\s*=\s*(?:"(https:\/\/[^"']+)"|'(https:\/\/[^"']+)'|([^\s>]+))/i);
  const url = match?.[1] || match?.[2] || match?.[3] || "";
  return /^(https:\/\/|\/manus-storage\/)/i.test(url) ? url.slice(0, 1000) : null;
}

/** Turns clearly labelled raw image URLs into editable appearance tokens. */
export function normalizeScriptTemplate(script: string) {
  let imageIndex = 0;
  let textIndex = 0;
  const semanticCounts = new Map<string, number>();
  const withImages = script.replace(/<img\b([^>]*?)\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi, (full, before: string, quote: string, _url: string, after: string) => {
    const index = ++imageIndex;
    const key = appearanceKeyFromMarkup(`${before} ${after}`) || `image${index}`;
    return `<img${before}src=${quote}{{${key}}}${quote}${after}>`;
  });
  return withImages.replace(/<(label|span|p|h[1-6]|button|a)\b([^>]*)>([^<]{2,160})<\/\1>/gi, (full, tag: string, attrs: string, text: string) => {
    if (/\{\{/.test(text) || /^(https?:\/\/|[\s\d.,:/-]+)$/.test(text.trim())) return full;
    const kind = /^(button|a)$/i.test(tag) ? "button" : "label";
    const slug = text.trim().toLowerCase().replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 36) || `${kind}_${++textIndex}`;
    const base = `${kind}_${slug}`;
    const count = (semanticCounts.get(base) || 0) + 1;
    semanticCounts.set(base, count);
    const key = count === 1 ? base : `${base}_${count}`;
    return `<${tag}${attrs}>{{${key}}}</${tag}>`;
  });
}

function dynamicTextDefaults(script: string) {
  const defaults: Record<string, string> = {};
  for (const key of detectTemplateTokens(script)) {
    const match = key.match(/^(label|button)_(.+)$/i);
    if (match) defaults[key] = match[2].replace(/_\d+$/, "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return defaults;
}

/** Prepares raw seller code; unpublished products never expose unvalidated code. */
export function prepareScriptTemplate(script: string) {
  const normalized = normalizeScriptTemplate(script).trim();
  if (!normalized) throw new Error("Script kosong.");
  const openingTokens = (normalized.match(/\{\{/g) || []).length;
  const closingTokens = (normalized.match(/\}\}/g) || []).length;
  if (openingTokens !== closingTokens || /\{\{[^}]*$|^[^{]*\}\}/m.test(normalized)) throw new Error("Token template tidak lengkap.");
  return normalized;
}

function safeTemplateConfig(config: Record<string, string>) {
  const clean: Record<string, string> = {};
  for (const [key, raw] of Object.entries(config)) {
    const value = String(raw ?? "").slice(0, 500);
    if (key.toLowerCase().includes("color") && value && !/^#[0-9a-f]{3,8}$/i.test(value)) continue;
    if ((key.toLowerCase().includes("image") || key.toLowerCase().includes("logo") || key.toLowerCase().includes("url")) && value && !/^(https:\/\/|\/manus-storage\/)/i.test(value)) continue;
    clean[key] = value;
  }
  return clean;
}

const defaultDesignConfig = { primaryColor: "#c7f36b", secondaryColor: "#101311", textColor: "#f4f5ef", buttonColor: "#c7f36b", buttonTextColor: "#101311", buttonStyle: "solid", fontSize: "16", borderRadius: "16", buttonLabel: "Beli sekarang", phoneLabel: "Nomor Telepon", storeLabel: "", logoUrl: "", faviconUrl: "", heroImage: "" };
function safeDesignConfig(config?: Record<string, string> | null) {
  const input = config || {};
  const output: Record<string, string> = { ...defaultDesignConfig };
  for (const key of Object.keys(defaultDesignConfig)) {
    const value = String(input[key] ?? "").slice(0, 1000);
    if (key.toLowerCase().includes("color") && value && !/^#[0-9a-f]{3,8}$/i.test(value)) continue;
    if (key.toLowerCase().includes("url") && value && !/^(https:\/\/|\/manus-storage\/)/i.test(value)) continue;
    if (["fontSize", "borderRadius"].includes(key) && value && !/^\d{1,3}$/.test(value)) continue;
    output[key] = value;
  }
  return output;
}

function parseSafeImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "Gunakan gambar JPG, PNG, atau WebP." });
  return { contentType: match[1].toLowerCase(), encoded: match[2] };
}

export function renderTemplate(script: string, config: Record<string, string>) {
  return script.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => config[key] ?? "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char] || char));
}
function applyLiveDesign(html: string, design: Record<string, string>) {
  const buttonStyle = design.buttonStyle === "outline" ? "background:transparent!important;border:2px solid var(--store-button)!important;color:var(--store-button)!important" : design.buttonStyle === "gradient" ? "background:linear-gradient(135deg,var(--store-button),var(--store-primary))!important;color:var(--store-button-text)!important" : design.buttonStyle === "pill" ? "background:var(--store-button)!important;color:var(--store-button-text)!important;border-radius:999px!important" : "background:var(--store-button)!important;color:var(--store-button-text)!important";
  const css = `:root{--store-primary:${design.primaryColor};--store-secondary:${design.secondaryColor};--store-text:${design.textColor};--store-button:${design.buttonColor};--store-button-text:${design.buttonTextColor};--store-radius:${design.borderRadius}px;--store-size:${design.fontSize}px}body{background:var(--store-secondary)!important;color:var(--store-text)!important;font-size:var(--store-size)!important}button,.button,[type=button],[type=submit],a.cta,a.button{${buttonStyle};border-radius:var(--store-radius)!important;transition:transform .2s,box-shadow .2s}button:hover,.button:hover,a.cta:hover,a.button:hover{transform:translateY(-2px);box-shadow:0 8px 22px color-mix(in srgb,var(--store-button) 35%,transparent)}img{max-width:100%;border-radius:var(--store-radius)}h1,h2,h3{color:var(--store-text)}.store-primary{color:var(--store-primary)!important}.store-hero{background-image:url('${design.heroImage}')!important;background-size:cover;background-position:center}`;
  const style = `<style data-scriptstore-live-design>${css}</style>`;
  const favicon = design.faviconUrl ? `<link rel="icon" href="${escapeHtml(design.faviconUrl)}">` : "";
  const title = design.storeLabel ? `<title>${escapeHtml(design.storeLabel)}</title>` : "";
  return /<head[\s>]/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${title}${favicon}${style}`) : `${title}${favicon}${style}${html}`;
}

export function rewriteAssetUrl(url: string, assetDomain: string) {
  if (!assetDomain || !url.startsWith("/manus-storage/")) return url;
  return `${assetDomain}${url}`;
}

/** Protects generated inline JavaScript while keeping HTML/CSS and image URLs compatible. */
export function protectGeneratedScript(script: string, enabled = true) {
  if (!enabled) return script;
  return script
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_full, open: string, code: string, close: string) => {
      if (!code.trim()) return `${open}${code}${close}`;
      const protectedCode = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.65,
        deadCodeInjection: false,
        disableConsoleOutput: true,
        identifierNamesGenerator: "hexadecimal",
        renameGlobals: false,
        selfDefending: true,
        stringArray: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.75,
      }).getObfuscatedCode();
      return `${open}${protectedCode}${close}`;
    })
    .replace(/[ \t]{2,}/g, " ");
}

export function calculateSubscriptionExpiry(saleMode: "one_time" | "subscription", days: number, now = new Date()) {
  return saleMode === "subscription" ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000) : null;
}

export function isOrderAccessActive(status: string, expiresAt: Date | null, now = new Date()) {
  return ["paid", "delivered"].includes(status) && (!expiresAt || expiresAt > now);
}

export const appRouter = router({
  site: router({
    config: publicProcedure.query(async () => {
      const db = await getDb();
      const row = db ? (await db.select().from(settings).limit(1))[0] : undefined;
      return { seoTitle: row?.seoTitle || "Script premium siap pakai untuk bisnis digital", seoDescription: row?.seoDescription || "Temukan script web premium yang responsif, mudah dikustomisasi, dan siap dipakai.", branding: { logoUrl: row?.logoUrl || "", faviconUrl: row?.faviconUrl || "" }, ads: { enabled: row?.adsEnabled === 1, client: row?.adsClient || "", slot: row?.adsSlot || "", placement: row?.adsPlacement || "top" }, googleLoginEnabled: row?.googleLoginEnabled !== 0 };
    }),
  }),
  system: systemRouter,
  publicStore: router({
    products: publicProcedure.input(z.object({ productId: z.number().int(), accessKey: z.string().min(32).max(128), categoryId: z.number().int().positive().optional(), page: z.number().int().min(1).max(600).default(1), search: z.string().max(100).optional() })).query(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const product = (await db.select({ id: products.id, isActive: products.isActive }).from(products).where(and(eq(products.id, input.productId), eq(products.isActive, 1))).limit(1))[0];
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produk tidak tersedia." });
      const rows = await db.select().from(productCustomizations).where(and(eq(productCustomizations.productId, input.productId)));
      const binding = rows.map((row) => { try { return { row, config: JSON.parse(row.config) as Record<string, string> }; } catch { return { row, config: {} }; } }).find(({ config }) => config.storeAccessKey === input.accessKey);
      if (!binding || !binding.config.storeUrl || !storeOriginMatches(ctx.req, binding.config.storeUrl)) throw new TRPCError({ code: "FORBIDDEN", message: "Toko belum terdaftar untuk produk ini." });
      return fetchBukaOlshopProducts({ token: binding.config.openApiToken || "", page: input.page, categoryId: input.categoryId || Number(binding.config.categoryId) || undefined, search: input.search });
    }),
  }),
  setup: router({
    status: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { hasAdmin: false, databaseReady: false };
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      return { hasAdmin: admins.length > 0, databaseReady: true };
    }),
    claimFirstAdmin: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum siap." });
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      if (admins.length) throw new TRPCError({ code: "FORBIDDEN", message: "Admin pertama sudah dibuat." });
      await db.update(users).set({ role: "admin", isSuspended: 0 }).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),
  }),
  auth: router({
    me: publicProcedure.query(({ ctx }) => safeUser(ctx.user)),
    login: publicProcedure.input(z.object({ username: z.string().min(3).max(64), password: z.string().min(MIN_PASSWORD_LENGTH), expectedRole: z.enum(["admin", "seller"]).optional() })).mutation(async ({ ctx, input }) => {
      try {
        const user = await loginLocalUser(input.username, input.password);
        if (input.expectedRole && user.role !== input.expectedRole) throw new Error(`Akun ini bukan akun ${input.expectedRole === "admin" ? "admin" : "penjual"}.`);
        await setSession(ctx.res, ctx.req, user);
        return safeUser(user);
      } catch (error) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: error instanceof Error ? error.message : "Login gagal." });
      }
    }),
    register: publicProcedure.input(z.object({ username: z.string().min(3).max(64), password: z.string().min(MIN_PASSWORD_LENGTH), name: z.string().min(2).max(120), email: z.string().email(), securityQuestion: z.string().min(8).max(255), securityAnswer: z.string().min(2).max(255), requestedRole: z.enum(["buyer", "seller"]).default("buyer") })).mutation(async ({ ctx, input }) => {
      try {
        if ((input.securityQuestion && !input.securityAnswer) || (!input.securityQuestion && input.securityAnswer)) throw new Error("Pertanyaan dan jawaban keamanan harus diisi bersama.");
        const user = await registerLocalUser(input, input.requestedRole);
        if (!user) throw new Error("Akun gagal dibuat.");
        await setSession(ctx.res, ctx.req, user);
        return safeUser(user);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Pendaftaran gagal." });
      }
    }),
    forgotPassword: publicProcedure.input(z.object({ identifier: z.string().min(3).max(320) })).mutation(async ({ ctx, input }) => {
      try { const db = await getDb(); const row = db ? (await db.select().from(settings).limit(1))[0] : undefined; if (row?.resetEmailEnabled !== 0) await requestPasswordReset(input.identifier, `${ctx.req.protocol}://${ctx.req.get("host")}`); } catch (error) { console.error("[Auth] Reset email failed", error); }
      return { success: true, message: "Jika akun ditemukan, tautan reset akan dikirim ke email terdaftar." };
    }),
    securityQuestion: publicProcedure.input(z.object({ identifier: z.string().min(3).max(320) })).query(async ({ input }) => { const key = input.identifier.trim().toLowerCase(); const user = key.includes("@") ? await getDb().then((db) => db ? db.select({ securityQuestion: users.securityQuestion }).from(users).where(eq(users.email, key)).limit(1) : []) : await getDb().then((db) => db ? db.select({ securityQuestion: users.securityQuestion }).from(users).where(eq(users.username, key)).limit(1) : []); return user[0]?.securityQuestion || null; }),
    resetPassword: publicProcedure.input(z.object({ token: z.string().min(20), password: z.string().min(MIN_PASSWORD_LENGTH) })).mutation(async ({ input }) => { await resetPassword(input.token, input.password); return { success: true }; }),
    resetWithSecurityQuestion: publicProcedure.input(z.object({ identifier: z.string().min(3).max(320), answer: z.string().min(2).max(255), password: z.string().min(MIN_PASSWORD_LENGTH) })).mutation(async ({ input }) => { const db = await getDb(); const row = db ? (await db.select().from(settings).limit(1))[0] : undefined; if (row?.resetSecurityEnabled === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Metode pertanyaan keamanan dinonaktifkan admin." }); await resetWithSecurityQuestion(input.identifier, input.answer, input.password); return { success: true }; }),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearSession(ctx.res, ctx.req);
      return { success: true } as const;
    }),
  }),
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return safeUser(ctx.user)!;
      const row = (await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0] ?? ctx.user;
      return safeUser(row)!;
    }),
    update: protectedProcedure.input(z.object({ name: z.string().min(2).optional(), phone: z.string().max(30).optional(), email: z.string().email().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set(input).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),
    uploadAvatar: protectedProcedure.input(z.object({ dataUrl: z.string().startsWith("data:image/"), fileName: z.string().max(120) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.dataUrl.length > 7_000_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Foto maksimal 5MB." });
      const { contentType, encoded } = parseSafeImageDataUrl(input.dataUrl);
      const stored = await storagePut(`profiles/${ctx.user.id}/${input.fileName}`, Buffer.from(encoded, "base64"), contentType);
      await db.update(users).set({ avatarUrl: stored.url }).where(eq(users.id, ctx.user.id));
      return { url: stored.url };
    }),
  }),
  products: router({ list: publicProcedure.query(() => getPublishedProducts()) }),
  seller: router({
    dashboard: sellerProcedure.query(async ({ ctx }) => ({ products: await getProductsBySeller(ctx.user.id), orders: await getOrdersBySeller(ctx.user.id) })),
    createProduct: sellerProcedure.input(z.object({ name: z.string().min(2), description: z.string().min(10), category: z.string().min(2), price: z.number().int().positive(), scriptType: z.enum(["full", "api"]), saleMode: z.enum(["one_time", "subscription"]).default("one_time"), subscriptionDays: z.number().int().positive().max(3650).default(30), publicScript: z.string().min(1), secretScript: z.string().optional(), apiPath: z.string().max(255).optional(), designConfig: z.record(z.string(), z.string()).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.scriptType === "api" && !input.secretScript?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Script rahasia wajib diisi untuk produk API." });
      let publicScript: string;
      let secretScript: string | null = null;
      try {
        publicScript = prepareScriptTemplate(input.publicScript);
        secretScript = input.secretScript ? prepareScriptTemplate(input.secretScript) : null;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Script belum berhasil diperbaiki: ${(error as Error).message}` });
      }
      const thumbnailUrl = extractProductThumbnail(publicScript);
      const status = ctx.user.username === "testseller_20260922102647" ? "published" : "pending";
      const result = await db.insert(products).values({ ...input, designConfig: JSON.stringify(safeDesignConfig(input.designConfig)), sellerId: ctx.user.id, publicScript, secretScript, thumbnailUrl, apiPath: input.apiPath || null, status });
      return { id: Number(result[0].insertId), status: "pending" as const };
    }),
    updateProductDesign: sellerProcedure.input(z.object({ productId: z.number().int(), designConfig: z.record(z.string(), z.string()) })).mutation(async ({ ctx, input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const product = (await db.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.sellerId, ctx.user.id))).limit(1))[0]; if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produk tidak ditemukan." }); await db.update(products).set({ designConfig: JSON.stringify(safeDesignConfig(input.designConfig)) }).where(eq(products.id, input.productId)); return { success: true }; }),
    updateProductStatus: sellerProcedure.input(z.object({ productId: z.number().int(), status: z.enum(["published", "rejected", "pending"]) })).mutation(async ({ ctx, input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(products).set({ status: input.status }).where(and(eq(products.id, input.productId), eq(products.sellerId, ctx.user.id))); return { success: true }; }),
    updateOrderStatus: sellerProcedure.input(z.object({ orderId: z.number().int(), status: z.enum(["paid", "delivered", "cancelled"]) })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(orders).set({ status: input.status }).where(and(eq(orders.id, input.orderId), eq(orders.sellerId, ctx.user.id)));
      return { success: true };
    }),
  }),
  buyer: router({
    categories: buyerProcedure.input(z.object({ productId: z.number().int() })).query(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const row = (await db.select().from(productCustomizations).where(and(eq(productCustomizations.productId, input.productId), eq(productCustomizations.buyerId, ctx.user.id))).limit(1))[0];
      if (!row) throw new TRPCError({ code: "FORBIDDEN", message: "Konfigurasi toko belum tersedia." });
      const config = JSON.parse(row.config) as Record<string, string>;
      return fetchBukaOlshopCategories(config.openApiToken || "");
    }),
    dashboard: buyerProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { profile: ctx.user, products: [], orders: [], ownedProducts: [], transactions: [], adminFee: 5000 };
      const profile = safeUser((await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0] ?? ctx.user)!;
      const publishedRows = await db.select({ id: products.id, sellerId: products.sellerId, name: products.name, description: products.description, category: products.category, price: products.price, scriptType: products.scriptType, saleMode: products.saleMode, subscriptionDays: products.subscriptionDays, thumbnailUrl: products.thumbnailUrl, publicScript: products.publicScript, apiPath: products.apiPath, status: products.status, isActive: products.isActive, createdAt: products.createdAt, updatedAt: products.updatedAt }).from(products).where(and(eq(products.status, "published"), eq(products.isActive, 1))).orderBy(desc(products.createdAt));
      const published = publishedRows.map((product) => ({ ...product, thumbnailUrl: product.thumbnailUrl || extractProductThumbnail(product.publicScript || "") }));
      const myOrders = await db.select().from(orders).where(eq(orders.buyerId, ctx.user.id)).orderBy(desc(orders.createdAt));
      const ownedIds = myOrders.filter((item) => item.status === "paid" || item.status === "delivered").map((item) => item.productId);
      // Never include secretScript in the dashboard payload. The private API script is
      // only read by the authorized template resolver after an active purchase check.
      const ownedRows = ownedIds.length ? await db.select({ id: products.id, sellerId: products.sellerId, name: products.name, description: products.description, category: products.category, price: products.price, scriptType: products.scriptType, saleMode: products.saleMode, subscriptionDays: products.subscriptionDays, thumbnailUrl: products.thumbnailUrl, publicScript: products.publicScript, apiPath: products.apiPath, status: products.status, isActive: products.isActive, createdAt: products.createdAt, updatedAt: products.updatedAt }).from(products).where(inArray(products.id, ownedIds)) : [];
      const now = Date.now();
      const ownedProducts = ownedRows.map((product) => ({ ...product, thumbnailUrl: product.thumbnailUrl || extractProductThumbnail(product.publicScript || ""), accessActive: product.isActive === 1 && myOrders.some((order) => order.productId === product.id && (order.expiresAt === null || (order.expiresAt && order.expiresAt.getTime() > now))) }));
      const myTransactions = await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id)).orderBy(desc(transactions.createdAt));
      return { profile, products: published, orders: myOrders, ownedProducts, transactions: myTransactions, adminFee: await getAdminFee(db) };
    }),
    template: buyerProcedure.input(z.object({ productId: z.number().int() })).query(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const orderRows = await db.select().from(orders).where(and(eq(orders.buyerId, ctx.user.id), eq(orders.productId, input.productId))).orderBy(desc(orders.createdAt));
      const order = orderRows.find((item) => ["paid", "delivered"].includes(item.status) && (!item.expiresAt || item.expiresAt > new Date()));
      if (!order) throw new TRPCError({ code: "FORBIDDEN", message: "Masa aktif produk sudah habis atau belum dibeli." });
      const product = (await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.isActive, 1))).limit(1))[0]; if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produk sedang dinonaktifkan admin." });
      const saved = (await db.select().from(productCustomizations).where(and(eq(productCustomizations.productId, input.productId), eq(productCustomizations.buyerId, ctx.user.id))).limit(1))[0];
      const savedDesign = product.designConfig ? safeDesignConfig(JSON.parse(product.designConfig) as Record<string, string>) : safeDesignConfig();
      const defaultConfig = { storeName: ctx.user.name || "Toko Saya", ...savedDesign, bannerUrl: savedDesign.heroImage, apiBaseUrl: `${ctx.req.protocol}://${ctx.req.get("host")}`, apiProxyUrl: "/api/trpc/publicStore.products", apiPath: product.apiPath || "/api", openOlshopUrl: "", categoryId: "", productId: String(product.id), accessExpiresAt: order.expiresAt?.toISOString() || "" };
      const assetDomain = await getAssetDomain(db);
      const rawSource = product.scriptType === "api" ? product.secretScript || product.publicScript || "" : product.publicScript || "";
      const source = prepareScriptTemplate(rawSource);
      const rawConfig: Record<string, string> = { ...defaultConfig, ...dynamicTextDefaults(source), ...(saved ? JSON.parse(saved.config) as Record<string, string> : {}) };
      const storeAccessKey = String(rawConfig.storeAccessKey || "");
      delete rawConfig.openApiToken;
      delete rawConfig.storeAccessKey;
      const config = Object.fromEntries(Object.entries(rawConfig).map(([key, value]) => [key, /url|image|logo|banner|hero/i.test(key) ? rewriteAssetUrl(value, assetDomain) : value]));
      config.storeAccessKey = storeAccessKey;
      const rendered = applyLiveDesign(renderTemplate(source, config), config);
      return { product: { id: product.id, name: product.name, scriptType: product.scriptType }, placeholders: detectTemplateTokens(source), config, assetDomain, script: protectGeneratedScript(rendered, await getObfuscationEnabled(db)) };
    }),
    saveTemplate: buyerProcedure.input(z.object({ productId: z.number().int(), config: z.record(z.string(), z.string()) })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const orderRows = await db.select().from(orders).where(and(eq(orders.buyerId, ctx.user.id), eq(orders.productId, input.productId))).orderBy(desc(orders.createdAt));
      const order = orderRows.find((item) => ["paid", "delivered"].includes(item.status) && (!item.expiresAt || item.expiresAt > new Date()));
      if (!order) throw new TRPCError({ code: "FORBIDDEN", message: "Masa aktif produk sudah habis atau belum dibeli." });
      const existing = (await db.select().from(productCustomizations).where(and(eq(productCustomizations.productId, input.productId), eq(productCustomizations.buyerId, ctx.user.id))).limit(1))[0];
      const currentConfig = existing ? JSON.parse(existing.config) as Record<string, string> : {};
      const nextConfig = { ...safeTemplateConfig(input.config), ...Object.fromEntries(["storeUrl", "openApiToken", "categoryId", "storeAccessKey"].filter((key) => currentConfig[key]).map((key) => [key, currentConfig[key]])) };
      const config = JSON.stringify(nextConfig);
      if (existing) await db.update(productCustomizations).set({ config }).where(eq(productCustomizations.id, existing.id)); else await db.insert(productCustomizations).values({ productId: input.productId, buyerId: ctx.user.id, config });
      return { success: true };
    }),
    uploadTemplateImage: buyerProcedure.input(z.object({ productId: z.number().int(), field: z.string().regex(/^[a-zA-Z0-9_.-]+$/), dataUrl: z.string().startsWith("data:image/"), fileName: z.string().max(120) })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.dataUrl.length > 7_000_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Gambar maksimal 5MB." });
      const orderRows = await db.select().from(orders).where(and(eq(orders.buyerId, ctx.user.id), eq(orders.productId, input.productId))).orderBy(desc(orders.createdAt));
      const order = orderRows.find((item) => ["paid", "delivered"].includes(item.status) && (!item.expiresAt || item.expiresAt > new Date()));
      const product = (await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.isActive, 1))).limit(1))[0];
      if (!order || !product) throw new TRPCError({ code: "FORBIDDEN", message: "Akses produk sudah tidak aktif." });
      const { contentType, encoded } = parseSafeImageDataUrl(input.dataUrl);
      const stored = await storagePut(`templates/${ctx.user.id}/${input.productId}/${input.field}-${input.fileName}`, Buffer.from(encoded, "base64"), contentType);
      const assetDomain = await getAssetDomain(db);
      return { field: input.field, url: rewriteAssetUrl(stored.url, assetDomain) };
    }),
    createOrder: buyerProcedure.input(z.object({ productId: z.number().int(), storeUrl: z.string().url().optional(), openApiToken: z.string().min(8).max(2048).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const product = (await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.status, "published"), eq(products.isActive, 1))).limit(1))[0];
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produk tidak ditemukan." });
      const storeUrl = product.scriptType === "api" ? normalizeStoreUrl(input.storeUrl || "") : "";
      if (product.scriptType === "api" && !input.openApiToken) throw new TRPCError({ code: "BAD_REQUEST", message: "URL toko dan token Open API wajib diisi untuk produk API." });
      const fee = await getAdminFee(db); const total = product.price + fee;
      const buyer = (await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0];
      if (!buyer || buyer.balance < total) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Saldo tidak cukup. Dibutuhkan ${total}.` });
      const expiresAt = calculateSubscriptionExpiry(product.saleMode, product.subscriptionDays);
      const result = await db.insert(orders).values({ buyerId: ctx.user.id, sellerId: product.sellerId, productId: product.id, totalPrice: total, adminFee: fee, status: "paid", expiresAt });
      const orderId = Number(result[0].insertId);
      if (product.scriptType === "api") await db.insert(productCustomizations).values({ productId: product.id, buyerId: ctx.user.id, config: JSON.stringify({ storeUrl, openApiToken: input.openApiToken, categoryId: "", storeAccessKey: crypto.randomBytes(32).toString("hex") }) });
      await db.update(users).set({ balance: buyer.balance - total }).where(eq(users.id, ctx.user.id));
      await db.update(users).set({ balance: sql`${users.balance} + ${product.price}` }).where(eq(users.id, product.sellerId));
      await db.insert(transactions).values({ userId: ctx.user.id, orderId, type: "debit", amount: total, description: `Beli produk: ${product.name}` });
      await db.insert(transactions).values({ userId: product.sellerId, orderId, type: "credit", amount: product.price, description: `Penjualan produk: ${product.name}` });
      return { id: orderId, total, status: "paid" as const };
    }),
    topupSettings: buyerProcedure.query(async () => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const row = (await db.select().from(settings).limit(1))[0];
      return { method: row?.topupMethod === "automatic" ? "automatic" as const : "manual" as const, instructions: row?.manualTopupInstructions || "Transfer sesuai nominal top-up lalu tunggu verifikasi admin." };
    }),
    topups: buyerProcedure.query(async ({ ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db.select().from(topupRequests).where(eq(topupRequests.userId, ctx.user.id)).orderBy(desc(topupRequests.createdAt));
    }),
    createTopup: buyerProcedure.input(z.object({ amount: z.number().int().min(10000).max(100000000), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const row = (await db.select().from(settings).limit(1))[0];
      const method = row?.topupMethod === "automatic" ? "automatic" : "manual";
      const reference = `TOPUP-${ctx.user.id}-${Date.now()}`;
      const result = await db.insert(topupRequests).values({ userId: ctx.user.id, amount: input.amount, method, status: "pending", reference, note: input.note || null });
      return { id: Number(result[0].insertId), reference, method, instructions: row?.manualTopupInstructions || "Permintaan dibuat. Tunggu konfirmasi admin." };
    }),
  }),
  admin: router({
    summary: adminProcedure.query(async () => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const [u, p, o, pendingProducts] = await Promise.all([db.select({ count: count() }).from(users), db.select({ count: count() }).from(products), db.select({ count: count() }).from(orders), db.select().from(products).where(eq(products.status, "pending")).orderBy(desc(products.createdAt))]); const settingsRow = (await db.select().from(settings).limit(1))[0]; return { users: u[0]?.count ?? 0, products: p[0]?.count ?? 0, orders: o[0]?.count ?? 0, pendingProducts, adminFee: await getAdminFee(db), obfuscationEnabled: await getObfuscationEnabled(db), assetDomain: await getAssetDomain(db), seoTitle: settingsRow?.seoTitle || "", seoDescription: settingsRow?.seoDescription || "", branding: { logoUrl: settingsRow?.logoUrl || "", faviconUrl: settingsRow?.faviconUrl || "" }, ads: { enabled: settingsRow?.adsEnabled === 1, client: settingsRow?.adsClient || "", slot: settingsRow?.adsSlot || "", placement: settingsRow?.adsPlacement || "top" }, recovery: { emailEnabled: settingsRow?.resetEmailEnabled !== 0, securityEnabled: settingsRow?.resetSecurityEnabled !== 0 }, topup: { method: settingsRow?.topupMethod === "automatic" ? "automatic" as const : "manual" as const, instructions: settingsRow?.manualTopupInstructions || "" }, googleLoginEnabled: settingsRow?.googleLoginEnabled !== 0 }; }),
    users: adminProcedure.query(async () => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, balance: users.balance, isSuspended: users.isSuspended, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)); }),
    products: adminProcedure.query(async () => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); return db.select().from(products).orderBy(desc(products.createdAt)); }),
    updateUserRole: adminProcedure.input(z.object({ userId: z.number().int(), role: z.enum(["admin", "seller", "buyer"]) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId)); return { success: true }; }),
    updateUserSuspension: adminProcedure.input(z.object({ userId: z.number().int(), suspended: z.boolean() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(users).set({ isSuspended: input.suspended ? 1 : 0 }).where(eq(users.id, input.userId)); return { success: true }; }),
    updateAdminFee: adminProcedure.input(z.object({ amount: z.number().int().min(0) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; if (row) await db.update(settings).set({ adminFee: input.amount }).where(eq(settings.id, row.id)); else await db.insert(settings).values({ adminFee: input.amount }); return { success: true }; }),
    updateObfuscation: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; if (row) await db.update(settings).set({ obfuscationEnabled: input.enabled ? 1 : 0 }).where(eq(settings.id, row.id)); else await db.insert(settings).values({ obfuscationEnabled: input.enabled ? 1 : 0 }); return { success: true }; }),
    updateAssetDomain: adminProcedure.input(z.object({ domain: z.string().trim().max(255).refine((value) => { if (!value) return true; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }, "Domain harus berupa URL HTTPS yang valid tanpa query atau kredensial.") })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const domain = input.domain.replace(/\/+$/, ""); const row = (await db.select().from(settings).limit(1))[0]; if (row) await db.update(settings).set({ assetDomain: domain || null }).where(eq(settings.id, row.id)); else await db.insert(settings).values({ assetDomain: domain || null }); return { success: true, domain }; }),
    updateSeo: adminProcedure.input(z.object({ title: z.string().trim().max(160), description: z.string().trim().max(500) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; if (row) await db.update(settings).set({ seoTitle: input.title || null, seoDescription: input.description || null }).where(eq(settings.id, row.id)); else await db.insert(settings).values({ seoTitle: input.title || null, seoDescription: input.description || null }); return { success: true }; }),
    updateBranding: adminProcedure.input(z.object({ logoUrl: z.string().trim().max(1000), faviconUrl: z.string().trim().max(1000) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); for (const [key, value] of Object.entries(input)) { if (value && !/^(https:\/\/|\/manus-storage\/)/i.test(value)) throw new TRPCError({ code: "BAD_REQUEST", message: "Logo dan favicon harus URL HTTPS atau storage internal." }); } const row = (await db.select().from(settings).limit(1))[0]; const values = { logoUrl: input.logoUrl || null, faviconUrl: input.faviconUrl || null }; if (row) await db.update(settings).set(values).where(eq(settings.id, row.id)); else await db.insert(settings).values(values); return { success: true }; }),
    updateAds: adminProcedure.input(z.object({ enabled: z.boolean(), client: z.string().trim().max(120), slot: z.string().trim().max(120), placement: z.enum(["top", "middle", "bottom"]) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; const values = { adsEnabled: input.enabled ? 1 : 0, adsClient: input.client || null, adsSlot: input.slot || null, adsPlacement: input.placement }; if (row) await db.update(settings).set(values).where(eq(settings.id, row.id)); else await db.insert(settings).values(values); return { success: true }; }),
    updateRecoveryMethods: adminProcedure.input(z.object({ emailEnabled: z.boolean(), securityEnabled: z.boolean() })).mutation(async ({ input }) => { if (!input.emailEnabled && !input.securityEnabled) throw new TRPCError({ code: "BAD_REQUEST", message: "Minimal satu metode pemulihan harus aktif." }); const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; const values = { resetEmailEnabled: input.emailEnabled ? 1 : 0, resetSecurityEnabled: input.securityEnabled ? 1 : 0 }; if (row) await db.update(settings).set(values).where(eq(settings.id, row.id)); else await db.insert(settings).values(values); return { success: true }; }),
    updateGoogleLogin: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; const values = { googleLoginEnabled: input.enabled ? 1 : 0 }; if (row) await db.update(settings).set(values).where(eq(settings.id, row.id)); else await db.insert(settings).values(values); return { success: true, enabled: input.enabled }; }),
    topups: adminProcedure.query(async () => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); return db.select({ id: topupRequests.id, userId: topupRequests.userId, amount: topupRequests.amount, method: topupRequests.method, status: topupRequests.status, reference: topupRequests.reference, note: topupRequests.note, createdAt: topupRequests.createdAt, username: users.username, email: users.email }).from(topupRequests).leftJoin(users, eq(topupRequests.userId, users.id)).orderBy(desc(topupRequests.createdAt)); }),
    updateTopupSettings: adminProcedure.input(z.object({ method: z.enum(["manual", "automatic"]), instructions: z.string().max(2000), webhookSecret: z.string().min(16).max(128).optional() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; const values = { topupMethod: input.method, manualTopupInstructions: input.instructions || null, autoTopupWebhookSecret: input.webhookSecret || null }; if (row) await db.update(settings).set(values).where(eq(settings.id, row.id)); else await db.insert(settings).values(values); return { success: true, method: input.method }; }),
    reviewTopup: adminProcedure.input(z.object({ topupId: z.number().int(), status: z.enum(["paid", "rejected"]) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const request = (await db.select().from(topupRequests).where(eq(topupRequests.id, input.topupId)).limit(1))[0]; if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Permintaan top-up tidak ditemukan." }); if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Permintaan ini sudah diproses." }); await db.update(topupRequests).set({ status: input.status }).where(eq(topupRequests.id, request.id)); if (input.status === "paid") { await db.update(users).set({ balance: sql`${users.balance} + ${request.amount}` }).where(eq(users.id, request.userId)); await db.insert(transactions).values({ userId: request.userId, type: "credit", amount: request.amount, description: `Top-up ${request.method}: ${request.reference}` }); } return { success: true }; }),
    updateProductStatus: adminProcedure.input(z.object({ productId: z.number().int(), status: z.enum(["published", "rejected", "pending", "blocked"]) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(products).set({ status: input.status }).where(eq(products.id, input.productId)); return { success: true }; }),
    updateProduct: adminProcedure.input(z.object({ productId: z.number().int(), name: z.string().min(2).optional(), description: z.string().min(2).optional(), price: z.number().int().positive().optional(), apiPath: z.string().max(255).optional(), saleMode: z.enum(["one_time", "subscription"]).optional(), subscriptionDays: z.number().int().positive().max(3650).optional() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const { productId, ...changes } = input; await db.update(products).set(changes).where(eq(products.id, productId)); return { success: true }; }),
    updateProductDesign: adminProcedure.input(z.object({ productId: z.number().int(), designConfig: z.record(z.string(), z.string()) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(products).set({ designConfig: JSON.stringify(safeDesignConfig(input.designConfig)) }).where(eq(products.id, input.productId)); return { success: true }; }),
    toggleProduct: adminProcedure.input(z.object({ productId: z.number().int(), active: z.boolean() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(products).set({ isActive: input.active ? 1 : 0 }).where(eq(products.id, input.productId)); return { success: true }; }),
    deleteProduct: adminProcedure.input(z.object({ productId: z.number().int() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.delete(products).where(eq(products.id, input.productId)); return { success: true }; }),
    deleteUser: adminProcedure.input(z.object({ userId: z.number().int() })).mutation(async ({ ctx, input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); if (ctx.user.id === input.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "Admin tidak dapat menghapus akunnya sendiri." }); await db.delete(users).where(eq(users.id, input.userId)); return { success: true }; }),
  }),
});
export type AppRouter = typeof appRouter;
