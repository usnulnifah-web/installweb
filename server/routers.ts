import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { orders, productCustomizations, products, settings, transactions, users } from "../drizzle/schema";
import { getDb, getOrdersBySeller, getProductsBySeller, getPublishedProducts } from "./db";
import { storagePut } from "./storage";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import JavaScriptObfuscator from "javascript-obfuscator";

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
  return script.replace(/<img\b([^>]*?)\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi, (full, before: string, quote: string, _url: string, after: string) => {
    const key = appearanceKeyFromMarkup(`${before} ${after}`);
    return key ? `<img${before}src=${quote}{{${key}}}${quote}${after}>` : full;
  });
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

function parseSafeImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "Gunakan gambar JPG, PNG, atau WebP." });
  return { contentType: match[1].toLowerCase(), encoded: match[2] };
}

export function renderTemplate(script: string, config: Record<string, string>) {
  return script.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => config[key] ?? "");
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
  system: systemRouter,
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
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const options = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...options, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return ctx.user;
      return (await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0] ?? ctx.user;
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
    createProduct: sellerProcedure.input(z.object({ name: z.string().min(2), description: z.string().min(10), category: z.string().min(2), price: z.number().int().positive(), scriptType: z.enum(["full", "api"]), saleMode: z.enum(["one_time", "subscription"]).default("one_time"), subscriptionDays: z.number().int().positive().max(3650).default(30), publicScript: z.string().min(1), secretScript: z.string().optional(), apiPath: z.string().max(255).optional() })).mutation(async ({ ctx, input }) => {
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
      const result = await db.insert(products).values({ ...input, sellerId: ctx.user.id, publicScript, secretScript, thumbnailUrl, apiPath: input.apiPath || null, status: "pending" });
      return { id: Number(result[0].insertId), status: "pending" as const };
    }),
    updateOrderStatus: sellerProcedure.input(z.object({ orderId: z.number().int(), status: z.enum(["paid", "delivered", "cancelled"]) })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(orders).set({ status: input.status }).where(and(eq(orders.id, input.orderId), eq(orders.sellerId, ctx.user.id)));
      return { success: true };
    }),
  }),
  buyer: router({
    dashboard: buyerProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { profile: ctx.user, products: [], orders: [], ownedProducts: [], transactions: [], adminFee: 5000 };
      const profile = (await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0] ?? ctx.user;
      const publishedRows = await db.select({ id: products.id, sellerId: products.sellerId, name: products.name, description: products.description, category: products.category, price: products.price, scriptType: products.scriptType, saleMode: products.saleMode, subscriptionDays: products.subscriptionDays, thumbnailUrl: products.thumbnailUrl, publicScript: products.publicScript, apiPath: products.apiPath, status: products.status, isActive: products.isActive, createdAt: products.createdAt, updatedAt: products.updatedAt }).from(products).where(and(eq(products.status, "published"), eq(products.isActive, 1))).orderBy(desc(products.createdAt));
      const published = publishedRows.map((product) => ({ ...product, thumbnailUrl: product.thumbnailUrl || extractProductThumbnail(product.publicScript || "") }));
      const myOrders = await db.select().from(orders).where(eq(orders.buyerId, ctx.user.id)).orderBy(desc(orders.createdAt));
      const ownedIds = myOrders.filter((item) => item.status === "paid" || item.status === "delivered").map((item) => item.productId);
      const ownedRows = ownedIds.length ? await db.select().from(products).where(inArray(products.id, ownedIds)) : [];
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
      const defaultConfig = { storeName: ctx.user.name || "Toko Saya", primaryColor: "#c7f36b", secondaryColor: "#101311", logoUrl: "", bannerUrl: "", heroImage: "", apiBaseUrl: "", apiPath: product.apiPath || "/api", openOlshopUrl: "", productId: String(product.id), accessExpiresAt: order.expiresAt?.toISOString() || "" };
      const assetDomain = await getAssetDomain(db);
      const rawConfig = { ...defaultConfig, ...(saved ? JSON.parse(saved.config) as Record<string, string> : {}) };
      const config = Object.fromEntries(Object.entries(rawConfig).map(([key, value]) => [key, /url|image|logo|banner|hero/i.test(key) ? rewriteAssetUrl(value, assetDomain) : value]));
      const source = product.scriptType === "api" ? product.secretScript || product.publicScript || "" : product.publicScript || "";
      const rendered = renderTemplate(source, config);
      return { product: { id: product.id, name: product.name, scriptType: product.scriptType }, placeholders: detectTemplateTokens(source), config, assetDomain, script: protectGeneratedScript(rendered, await getObfuscationEnabled(db)) };
    }),
    saveTemplate: buyerProcedure.input(z.object({ productId: z.number().int(), config: z.record(z.string(), z.string()) })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const orderRows = await db.select().from(orders).where(and(eq(orders.buyerId, ctx.user.id), eq(orders.productId, input.productId))).orderBy(desc(orders.createdAt));
      const order = orderRows.find((item) => ["paid", "delivered"].includes(item.status) && (!item.expiresAt || item.expiresAt > new Date()));
      if (!order) throw new TRPCError({ code: "FORBIDDEN", message: "Masa aktif produk sudah habis atau belum dibeli." });
      const config = JSON.stringify(safeTemplateConfig(input.config));
      const existing = (await db.select().from(productCustomizations).where(and(eq(productCustomizations.productId, input.productId), eq(productCustomizations.buyerId, ctx.user.id))).limit(1))[0];
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
    createOrder: buyerProcedure.input(z.object({ productId: z.number().int() })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database belum tersedia." });
      const product = (await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.status, "published"), eq(products.isActive, 1))).limit(1))[0];
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produk tidak ditemukan." });
      const fee = await getAdminFee(db); const total = product.price + fee;
      const buyer = (await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0];
      if (!buyer || buyer.balance < total) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Saldo tidak cukup. Dibutuhkan ${total}.` });
      const expiresAt = calculateSubscriptionExpiry(product.saleMode, product.subscriptionDays);
      const result = await db.insert(orders).values({ buyerId: ctx.user.id, sellerId: product.sellerId, productId: product.id, totalPrice: total, adminFee: fee, status: "paid", expiresAt });
      const orderId = Number(result[0].insertId);
      await db.update(users).set({ balance: buyer.balance - total }).where(eq(users.id, ctx.user.id));
      await db.update(users).set({ balance: sql`${users.balance} + ${product.price}` }).where(eq(users.id, product.sellerId));
      await db.insert(transactions).values({ userId: ctx.user.id, orderId, type: "debit", amount: total, description: `Beli produk: ${product.name}` });
      await db.insert(transactions).values({ userId: product.sellerId, orderId, type: "credit", amount: product.price, description: `Penjualan produk: ${product.name}` });
      return { id: orderId, total, status: "paid" as const };
    }),
  }),
  admin: router({
    summary: adminProcedure.query(async () => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const [u, p, o, pendingProducts] = await Promise.all([db.select({ count: count() }).from(users), db.select({ count: count() }).from(products), db.select({ count: count() }).from(orders), db.select().from(products).where(eq(products.status, "pending")).orderBy(desc(products.createdAt))]); return { users: u[0]?.count ?? 0, products: p[0]?.count ?? 0, orders: o[0]?.count ?? 0, pendingProducts, adminFee: await getAdminFee(db), obfuscationEnabled: await getObfuscationEnabled(db), assetDomain: await getAssetDomain(db) }; }),
    users: adminProcedure.query(async () => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, balance: users.balance, isSuspended: users.isSuspended, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)); }),
    products: adminProcedure.query(async () => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); return db.select().from(products).orderBy(desc(products.createdAt)); }),
    updateUserRole: adminProcedure.input(z.object({ userId: z.number().int(), role: z.enum(["admin", "seller", "buyer"]) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId)); return { success: true }; }),
    updateUserSuspension: adminProcedure.input(z.object({ userId: z.number().int(), suspended: z.boolean() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(users).set({ isSuspended: input.suspended ? 1 : 0 }).where(eq(users.id, input.userId)); return { success: true }; }),
    updateAdminFee: adminProcedure.input(z.object({ amount: z.number().int().min(0) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; if (row) await db.update(settings).set({ adminFee: input.amount }).where(eq(settings.id, row.id)); else await db.insert(settings).values({ adminFee: input.amount }); return { success: true }; }),
    updateObfuscation: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const row = (await db.select().from(settings).limit(1))[0]; if (row) await db.update(settings).set({ obfuscationEnabled: input.enabled ? 1 : 0 }).where(eq(settings.id, row.id)); else await db.insert(settings).values({ obfuscationEnabled: input.enabled ? 1 : 0 }); return { success: true }; }),
    updateAssetDomain: adminProcedure.input(z.object({ domain: z.string().trim().max(255).refine((value) => { if (!value) return true; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }, "Domain harus berupa URL HTTPS yang valid tanpa query atau kredensial.") })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const domain = input.domain.replace(/\/+$/, ""); const row = (await db.select().from(settings).limit(1))[0]; if (row) await db.update(settings).set({ assetDomain: domain || null }).where(eq(settings.id, row.id)); else await db.insert(settings).values({ assetDomain: domain || null }); return { success: true, domain }; }),
    updateProductStatus: adminProcedure.input(z.object({ productId: z.number().int(), status: z.enum(["published", "rejected", "pending", "blocked"]) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(products).set({ status: input.status }).where(eq(products.id, input.productId)); return { success: true }; }),
    updateProduct: adminProcedure.input(z.object({ productId: z.number().int(), name: z.string().min(2).optional(), description: z.string().min(2).optional(), price: z.number().int().positive().optional(), apiPath: z.string().max(255).optional(), saleMode: z.enum(["one_time", "subscription"]).optional(), subscriptionDays: z.number().int().positive().max(3650).optional() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const { productId, ...changes } = input; await db.update(products).set(changes).where(eq(products.id, productId)); return { success: true }; }),
    toggleProduct: adminProcedure.input(z.object({ productId: z.number().int(), active: z.boolean() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.update(products).set({ isActive: input.active ? 1 : 0 }).where(eq(products.id, input.productId)); return { success: true }; }),
    deleteProduct: adminProcedure.input(z.object({ productId: z.number().int() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.delete(products).where(eq(products.id, input.productId)); return { success: true }; }),
    deleteUser: adminProcedure.input(z.object({ userId: z.number().int() })).mutation(async ({ ctx, input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); if (ctx.user.id === input.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "Admin tidak dapat menghapus akunnya sendiri." }); await db.delete(users).where(eq(users.id, input.userId)); return { success: true }; }),
  }),
});
export type AppRouter = typeof appRouter;
