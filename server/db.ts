import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, Order, PasswordResetToken, passwordResetTokens, Product, products, orders, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "avatarUrl", "loginMethod"] as const;
  for (const field of textFields) if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; } else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  values.lastSignedIn ??= new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) { const db = await getDb(); if (!db) return undefined; return (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0]; }
export async function getUserById(id: number) { const db = await getDb(); if (!db) return undefined; return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0]; }
export async function getUserByUsername(username: string) { const db = await getDb(); if (!db) return undefined; return (await db.select().from(users).where(eq(users.username, username)).limit(1))[0]; }
export async function getUserByEmail(email: string) { const db = await getDb(); if (!db) return undefined; return (await db.select().from(users).where(eq(users.email, email)).limit(1))[0]; }
export async function countAdmins() { const db = await getDb(); if (!db) return 0; const result = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin")); return Number(result[0]?.count ?? 0); }

export async function createPasswordResetToken(token: InsertPasswordResetToken) { const db = await getDb(); if (!db) throw new Error("Database belum siap."); await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, token.userId)); await db.insert(passwordResetTokens).values(token); }
export async function getPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | undefined> { const db = await getDb(); if (!db) return undefined; return (await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1))[0]; }
export async function consumePasswordResetToken(id: number) { const db = await getDb(); if (!db) throw new Error("Database belum siap."); await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id)); }

export async function getPublishedProducts(): Promise<Product[]> { const db = await getDb(); if (!db) return []; return db.select().from(products).where(and(inArray(products.status, ["pending", "published"]), eq(products.isActive, 1))).orderBy(desc(products.createdAt)); }
export async function getProductsBySeller(sellerId: number): Promise<Product[]> { const db = await getDb(); if (!db) return []; return db.select().from(products).where(eq(products.sellerId, sellerId)).orderBy(desc(products.createdAt)); }
export async function getOrdersByBuyer(buyerId: number): Promise<Order[]> { const db = await getDb(); if (!db) return []; return db.select().from(orders).where(eq(orders.buyerId, buyerId)).orderBy(desc(orders.createdAt)); }
export async function getOrdersBySeller(sellerId: number): Promise<Order[]> { const db = await getDb(); if (!db) return []; return db.select().from(orders).where(and(eq(orders.sellerId, sellerId))).orderBy(desc(orders.createdAt)); }
