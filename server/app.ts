import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { RPCHandler } from "@orpc/server/websocket";
import { WebSocketServer } from "ws";
import type { Fetch } from "@typesafe-ai/sdk";
import type { Config } from "./config.js";
import { createRouter } from "./router.js";

import { WorkspaceStore } from "./workspace-store.js";

export function createApp(
  config: Config,
  fetch?: Fetch,
  store = new WorkspaceStore(),
) {
  const app = new Hono();
  app.use("/*", serveStatic({ root: "./dist/frontend/browser" }));
  const server = createServer(getRequestListener(app.fetch));
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
  });
  const handler = new RPCHandler(createRouter(config, fetch, store));
  server.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    if (
      request.url !== "/rpc" ||
      (origin !== undefined &&
        (!URL.canParse(origin) ||
          new URL(origin).host !== request.headers.host))
    ) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      handler.upgrade(ws);
      sockets.emit("connection", ws, request);
    });
  });
  return {
    server,
    sockets,
    async close() {
      for (const socket of sockets.clients) {
        await handler.close(socket);
        socket.terminate();
      }
      await Promise.all([
        new Promise<void>((resolve) => sockets.close(() => resolve())),
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
      ]);
      store.close();
    },
  };
}
