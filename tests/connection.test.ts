import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "../server/app.js";
import { createRpcConnection } from "../frontend/src/rpc-connection.js";
import type { Config } from "../server/config.js";
import type { Fetch } from "@typesafe-ai/sdk";

const live: Config = { mode: "live", apiKey: "test", model: "jev-latest" };
async function start(config: Config = { mode: "demo" }, fetch?: Fetch) {
  const app = createApp(config, fetch);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/rpc`;
  return { ...app, url };
}
function connect(url: string) {
  return createRpcConnection({
    url,
    createSocket: (url) => new WebSocket(url),
    handshakeTimeout: 100,
    requestTimeout: 500,
  });
}

test(
  "concurrent calls multiplex one socket; HTTP RPC and foreign Origins are rejected",
  { timeout: 5000 },
  async () => {
    const app = await start();
    const connection = connect(app.url);
    let connections = 0;
    app.sockets.on("connection", () => connections++);
    try {
      const [status, result] = await Promise.all([
        connection.client.status(),
        connection.client.evaluate({ text: "hello" }),
      ]);
      assert.equal(status.mode, "demo");
      assert.equal(result.answers.clarity.score, 1.7);
      assert.equal(connections, 1);
      for (const path of ["/rpc", "/rpc/status", "/rpc/evaluate"]) {
        assert.equal(
          (await fetch(new URL(path, app.url.replace("ws:", "http:")))).status,
          404,
        );
      }
      const foreign = new WebSocket(app.url, {
        origin: "https://foreign.example",
      });
      const closed = new Promise<void>((resolve) =>
        foreign.on("close", () => resolve()),
      );
      foreign.on("error", () => {});
      await closed;
      assert.equal(connections, 1);
      const invalid = new WebSocket(`${app.url}/other`);
      invalid.on("error", () => {});
      await new Promise<void>((resolve) =>
        invalid.on("close", () => resolve()),
      );
      assert.equal(connections, 1);
    } finally {
      connection.close();
      await app.close();
    }
  },
);

test(
  "connection refusal settles; the same client recovers when a server starts later",
  { timeout: 5000 },
  async () => {
    const app = await start();
    const address = app.server.address();
    assert(address && typeof address !== "string");
    await app.close();
    const connection = connect(app.url);
    const replacement = createApp({ mode: "demo" });
    try {
      await assert.rejects(connection.client.status());
      replacement.server.listen(address.port, "127.0.0.1");
      await once(replacement.server, "listening");
      assert.equal((await connection.client.status()).mode, "demo");
    } finally {
      connection.close();
      await replacement.close();
    }
  },
);

test(
  "stalled handshake and silent open peer are bounded",
  { timeout: 5000 },
  async () => {
    const server = createServer();
    const rawSockets = new Set<import("node:net").Socket>();
    server.on("connection", (socket) => {
      rawSockets.add(socket);
      socket.on("close", () => rawSockets.delete(socket));
    });
    server.on("upgrade", () => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `ws://127.0.0.1:${address.port}/rpc`;
    const connection = createRpcConnection({
      url,
      createSocket: (url) => new WebSocket(url),
      handshakeTimeout: 100,
      requestTimeout: 2_000,
    });
    const sockets = new WebSocketServer({ noServer: true });
    try {
      const before = performance.now();
      await assert.rejects(connection.client.status());
      assert(
        performance.now() - before < 1_000,
        "handshake deadline must settle before the unary deadline",
      );
      server.removeAllListeners("upgrade");
      server.on("upgrade", (request, socket, head) =>
        sockets.handleUpgrade(request, socket, head, () => {}),
      );
      await assert.rejects(connection.client.status());
    } finally {
      connection.close();
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      for (const socket of rawSockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

for (const action of ["abort", "disconnect", "dispose"] as const) {
  test(
    `${action} ends an active evaluation, aborts upstream and never replays it`,
    { timeout: 5000 },
    async () => {
      const started = Promise.withResolvers<void>();
      const aborted = Promise.withResolvers<void>();
      let invocations = 0;
      const app = await start(live, async (_url, init) => {
        invocations++;
        assert(init?.signal);
        const signal = init.signal;
        started.resolve();
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted.resolve();
              reject(signal.reason);
            },
            { once: true },
          );
        });
      });
      const connection = connect(app.url);
      const controller = new AbortController();
      try {
        const pending = connection.client.evaluate(
          { text: "hello" },
          { signal: controller.signal },
        );
        const rejected = assert.rejects(pending);
        await started.promise;
        if (action === "abort") controller.abort();
        if (action === "disconnect")
          for (const socket of app.sockets.clients) socket.terminate();
        if (action === "dispose") connection.close();
        await rejected;
        await aborted.promise;
        if (action !== "dispose")
          assert.equal((await connection.client.status()).mode, "live");
        else await assert.rejects(connection.client.status());
        assert.equal(invocations, 1);
      } finally {
        connection.close();
        await app.close();
      }
    },
  );
}

test(
  "already aborted calls open no socket; disposal during deferred connect prevents later sockets",
  { timeout: 5000 },
  async () => {
    const app = await start();
    let created = 0;
    const connection = createRpcConnection({
      url: app.url,
      createSocket: (url) => {
        created++;
        return new WebSocket(url);
      },
    });
    try {
      await assert.rejects(
        connection.client.status(undefined, { signal: AbortSignal.abort() }),
      );
      assert.equal(created, 0);
      const pending = connection.client.status();
      connection.close();
      await assert.rejects(pending);
      await assert.rejects(connection.client.status());
      assert.equal(created, 1);
    } finally {
      connection.close();
      await app.close();
    }
  },
);

test(
  "a cancelled call does not cancel another call on the same connection",
  { timeout: 5000 },
  async () => {
    const app = await start();
    const connection = connect(app.url);
    try {
      const abort = new AbortController();
      const cancelled = connection.client.status(undefined, {
        signal: abort.signal,
      });
      const surviving = connection.client.evaluate({ text: "hello" });
      abort.abort();
      await assert.rejects(cancelled);
      assert.equal((await surviving).mode, "demo");
      assert.equal(app.sockets.clients.size, 1);
    } finally {
      connection.close();
      await app.close();
    }
  },
);

test(
  "an old closing generation cannot close its replacement",
  { timeout: 5000 },
  async () => {
    const app = await start();
    const sockets: WebSocket[] = [];
    const connection = createRpcConnection({
      url: app.url,
      createSocket: (url) => {
        const socket = new WebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    try {
      await connection.client.status();
      const previous = sockets[0];
      assert(previous);
      previous.close();
      const next = connection.client.status();
      await new Promise<void>((resolve) =>
        previous.on("close", () => resolve()),
      );
      assert.equal((await next).mode, "demo");
      assert.equal(
        (await connection.client.evaluate({ text: "hello" })).mode,
        "demo",
      );
      assert.equal(sockets.length, 2);
    } finally {
      connection.close();
      await app.close();
    }
  },
);

test(
  "server shutdown aborts active provider work and closes client connections",
  { timeout: 5000 },
  async () => {
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const app = await start(live, async (_url, init) => {
      assert(init?.signal);
      const signal = init.signal;
      started.resolve();
      return new Promise<Response>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted.resolve();
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    });
    const connection = connect(app.url);
    try {
      const pending = assert.rejects(
        connection.client.evaluate({ text: "hello" }),
      );
      await started.promise;
      await app.close();
      await pending;
      await aborted.promise;
      assert.equal(app.sockets.clients.size, 0);
    } finally {
      connection.close();
    }
  },
);
