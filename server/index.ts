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
app.server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
