import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 64 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  securityQuestion: varchar("securityQuestion", { length: 255 }),
  securityAnswerHash: varchar("securityAnswerHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 30 }),
  avatarUrl: text("avatarUrl"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "seller", "buyer"]).default("buyer").notNull(),
  balance: int("balance").default(0).notNull(),
  isSuspended: int("isSuspended").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const passwordResetTokens = mysqlTable("passwordResetTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(), sellerId: int("sellerId").notNull(), name: varchar("name", { length: 160 }).notNull(), description: text("description").notNull(), category: varchar("category", { length: 80 }).notNull(), price: int("price").notNull(),
  scriptType: mysqlEnum("scriptType", ["full", "api"]).default("full").notNull(), saleMode: mysqlEnum("saleMode", ["one_time", "subscription"]).default("one_time").notNull(), subscriptionDays: int("subscriptionDays").default(30).notNull(), apiPath: varchar("apiPath", { length: 255 }), thumbnailUrl: varchar("thumbnailUrl", { length: 1000 }), publicScript: text("publicScript"), secretScript: text("secretScript"),
  status: mysqlEnum("status", ["pending", "published", "rejected", "blocked"]).default("pending").notNull(), isActive: int("isActive").default(1).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(), buyerId: int("buyerId").notNull(), sellerId: int("sellerId").notNull(), productId: int("productId").notNull(), totalPrice: int("totalPrice").notNull(), adminFee: int("adminFee").default(0).notNull(), status: mysqlEnum("status", ["pending", "paid", "delivered", "cancelled"]).default("pending").notNull(), expiresAt: timestamp("expiresAt"), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const transactions = mysqlTable("transactions", { id: int("id").autoincrement().primaryKey(), userId: int("userId").notNull(), orderId: int("orderId"), type: mysqlEnum("type", ["credit", "debit"]).notNull(), amount: int("amount").notNull(), description: varchar("description", { length: 255 }).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull() });
export const settings = mysqlTable("settings", { id: int("id").autoincrement().primaryKey(), adminFee: int("adminFee").default(5000).notNull(), obfuscationEnabled: int("obfuscationEnabled").default(1).notNull(), resetEmailEnabled: int("resetEmailEnabled").default(1).notNull(), resetSecurityEnabled: int("resetSecurityEnabled").default(1).notNull(), googleLoginEnabled: int("googleLoginEnabled").default(1).notNull(), assetDomain: varchar("assetDomain", { length: 255 }), seoTitle: varchar("seoTitle", { length: 160 }), seoDescription: text("seoDescription"), logoUrl: varchar("logoUrl", { length: 1000 }), faviconUrl: varchar("faviconUrl", { length: 1000 }), adsEnabled: int("adsEnabled").default(0).notNull(), adsClient: varchar("adsClient", { length: 120 }), adsSlot: varchar("adsSlot", { length: 120 }), adsPlacement: varchar("adsPlacement", { length: 20 }).default("top").notNull(), topupMethod: varchar("topupMethod", { length: 20 }).default("manual").notNull(), manualTopupInstructions: text("manualTopupInstructions"), autoTopupWebhookSecret: varchar("autoTopupWebhookSecret", { length: 128 }), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() });
export const productCustomizations = mysqlTable("productCustomizations", { id: int("id").autoincrement().primaryKey(), productId: int("productId").notNull(), buyerId: int("buyerId").notNull(), config: text("config").notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() });
export const topupRequests = mysqlTable("topupRequests", { id: int("id").autoincrement().primaryKey(), userId: int("userId").notNull(), amount: int("amount").notNull(), method: mysqlEnum("method", ["manual", "automatic"]).notNull(), status: mysqlEnum("status", ["pending", "paid", "rejected"]).default("pending").notNull(), reference: varchar("reference", { length: 120 }).notNull(), note: varchar("note", { length: 500 }), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() });

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type ProductCustomization = typeof productCustomizations.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
