import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    // Keep in step with server/config.ts's DB_PATH so the CLI and the running
    // app never point at different databases.
    url: process.env.DB_PATH ?? "./data.db",
  },
});
