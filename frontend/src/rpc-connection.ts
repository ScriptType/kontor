import { createORPCClient, DynamicLink } from "@orpc/client";
import { RPCLink, type WebSocketLike } from "@orpc/client/websocket";
import { TimeoutLinkPlugin } from "@orpc/client/plugins";
import type { RouterContractClient } from "@orpc/contract";
import type { contract } from "../../shared/contract.js";

type Socket = WebSocketLike & Pick<WebSocket, "close">;

export function createRpcConnection({
  url,
  createSocket = (url: string): Socket => new WebSocket(url),
  handshakeTimeout = 3_000,
  requestTimeout = 15_000,
}: {
  url: string;
  createSocket?: (url: string) => Socket;
  handshakeTimeout?: number;
  requestTimeout?: number;
}) {
  const lifetime = new AbortController();
  let current:
    | {
        socket: Socket;
        link: RPCLink<Record<never, never>>;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  const link = new DynamicLink<Record<never, never>>((options) => {
    lifetime.signal.throwIfAborted();
    options.signal?.throwIfAborted();
    if (current && current.socket.readyState < 2) return current.link;
    const socket = createSocket(url);
    const disconnected = new AbortController();
    const timer = setTimeout(() => {
      if (socket.readyState === 0) {
        disconnected.abort(new Error("WebSocket connection timed out"));
        socket.close();
      }
    }, handshakeTimeout);
    socket.addEventListener("open", () => clearTimeout(timer), { once: true });
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timer);
        disconnected.abort(new Error("WebSocket connection closed"));
      },
      { once: true },
    );
    socket.addEventListener("error", () => {
      if (socket.readyState < 2) socket.close();
    });
    const generationLink = new RPCLink({
      connect: () => {
        lifetime.signal.throwIfAborted();
        if (socket.readyState >= 2)
          throw new Error("WebSocket connection closed");
        return socket;
      },
      reconnect: { enabled: false },
      plugins: [new TimeoutLinkPlugin({ timeout: requestTimeout })],
      interceptors: [
        ({ next, ...options }) =>
          next({
            ...options,
            signal: options.signal
              ? AbortSignal.any([
                  options.signal,
                  lifetime.signal,
                  disconnected.signal,
                ])
              : AbortSignal.any([lifetime.signal, disconnected.signal]),
          }),
      ],
    });
    current = { socket, link: generationLink, timer };
    return generationLink;
  });
  const client: RouterContractClient<typeof contract> = createORPCClient(link);
  return {
    client,
    close() {
      lifetime.abort();
      if (current) {
        clearTimeout(current.timer);
        current.socket.close();
      }
    },
  };
}
