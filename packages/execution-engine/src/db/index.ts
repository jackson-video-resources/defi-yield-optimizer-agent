import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL || "postgresql://localhost/defi_lp_engine";

const isRailway =
  connectionString.includes("railway.internal") ||
  connectionString.includes("rlwy.net") ||
  connectionString.includes("railway.net");

const client = postgres(connectionString, {
  ssl: isRailway ? { rejectUnauthorized: false } : false,
  connect_timeout: 30,
});

export const db = drizzle(client);
