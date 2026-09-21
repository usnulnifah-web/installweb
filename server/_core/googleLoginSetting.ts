import { settings } from "../../drizzle/schema";
import { getDb } from "../db";

export async function isGoogleLoginEnabled() {
  const database = await getDb();
  if (!database) return true;
  const row = (await database.select({ enabled: settings.googleLoginEnabled }).from(settings).limit(1))[0];
  return row?.enabled !== 0;
}
