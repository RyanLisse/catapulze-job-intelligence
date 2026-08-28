import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../../apps/server/.env",
});

export default defineConfig({
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  dialect: "postgresql",
  out: "./src/migrations",
  schema: [
    "./src/schema/auth.ts",
    "./src/schema/curated.ts",
    "./src/schema/staging.ts",
    "./src/schema/schemas.ts",
  ],
});
