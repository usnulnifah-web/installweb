import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(), openId: varchar("openId", { length: 64 }).notNull().unique(), name: text("name"), email: varchar("email", { length: 320 }), phone: varchar("phone", { length: 30 }), avatarUrl: text("avatarUrl"),
  loginMethod: varchar("loginMethod", { length: 64 }), role: mysqlEnum("role", ["admin", "seller", "buyer"]).default("buyer").notNull(), balance: int("balance").default(0).notNull(), isSuspended: int("isSuspended").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(), lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(), sellerId: int("sellerId").notNull(), name: varchar("name", { length: 160 }).notNull(), description: text("description").notNull(), category: varchar("category", { length: 80 }).notNull(), price: int("price").notNull(),
  scriptType: mysqlEnum("scriptType", ["full", "api"]).default("full").notNull(), saleMode: mysqlEnum("saleMode", ["one_time", "subscription"]).default("one_time").notNull(), subscriptionDays: int("subscriptionDays").default(30).notNull(), apiPath: varchar("apiPath", { length: 255 }), publicScript: text("publicScript"), secretScript: text("secretScript"),
  status: mysqlEnum("status", ["pending", "published", "rejected", "blocked"]).default("pending").notNull(), isActive: int("isActive").default(1).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(), buyerId: int("buyerId").notNull(), sellerId: int("sellerId").notNull(), productId: int("productId").notNull(), totalPrice: int("totalPrice").notNull(), adminFee: int("adminFee").default(0).notNull(), status: mysqlEnum("status", ["pending", "paid", "delivered", "cancelled"]).default("pending").notNull(), expiresAt: timestamp("expiresAt"), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const transactions = mysqlTable("transactions", { id: int("id").autoincrement().primaryKey(), userId: int("userId").notNull(), orderId: int("orderId"), type: mysqlEnum("type", ["credit", "debit"]).notNull(), amount: int("amount").notNull(), description: varchar("description", { length: 255 }).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull() });
export const settings = mysqlTable("settings", { id: int("id").autoincrement().primaryKey(), adminFee: int("adminFee").default(5000).notNull(), obfuscationEnabled: int("obfuscationEnabled").default(1).notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() });
export const productCustomizations = mysqlTable("productCustomizations", { id: int("id").autoincrement().primaryKey(), productId: int("productId").notNull(), buyerId: int("buyerId").notNull(), config: text("config").notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() });

export type User = typeof users.$inferSelect; export type InsertUser = typeof users.$inferInsert; export type Product = typeof products.$inferSelect; export type Order = typeof orders.$inferSelect; export type Transaction = typeof transactions.$inferSelect; export type ProductCustomization = typeof productCustomizations.$inferSelect;
