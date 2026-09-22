import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { assertProductionEnv } from "./env";
import { registerGoogleAuthRoutes } from "./googleAuth";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { settings, topupRequests, transactions, users } from "../../drizzle/schema";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  assertProductionEnv();

  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerGoogleAuthRoutes(app);
  app.post("/api/topup/webhook", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "Database belum siap." });
      const config = (await db.select().from(settings).limit(1))[0];
      const secret = String(req.header("x-topup-secret") || "");
      if (!config?.autoTopupWebhookSecret || secret !== config.autoTopupWebhookSecret) return res.status(401).json({ error: "Webhook tidak terautentikasi." });
      const reference = String(req.body?.reference || "");
      const amount = Number(req.body?.amount || 0);
      if (!reference || !Number.isInteger(amount) || amount < 10000) return res.status(400).json({ error: "reference dan amount valid wajib diisi." });
      const request = (await db.select().from(topupRequests).where(eq(topupRequests.reference, reference)).limit(1))[0];
      if (!request || request.method !== "automatic" || request.amount !== amount) return res.status(404).json({ error: "Permintaan top-up tidak cocok." });
      if (request.status === "paid") return res.json({ success: true, duplicate: true });
      if (request.status !== "pending") return res.status(409).json({ error: "Permintaan sudah ditolak." });
      await db.update(topupRequests).set({ status: "paid" }).where(eq(topupRequests.id, request.id));
      await db.update(users).set({ balance: sql`${users.balance} + ${request.amount}` }).where(eq(users.id, request.userId));
      await db.insert(transactions).values({ userId: request.userId, type: "credit", amount: request.amount, description: `Top-up otomatis: ${request.reference}` });
      return res.json({ success: true, reference });
    } catch (error) { console.error("[Topup webhook]", error); return res.status(500).json({ error: "Webhook gagal diproses." }); }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
