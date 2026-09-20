import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig(process.env);
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .parse(process.env["PORT"] ?? 3000);
const app = createApp(config);
app.use("/*", serveStatic({ root: "./dist/frontend/browser" }));
serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
