import { DestroyRef, inject, InjectionToken } from "@angular/core";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createRpcConnection } from "./rpc-connection";

export const ORPC = new InjectionToken("ORPC", {
  providedIn: "root",
  factory: () => {
    const url = new URL("/rpc", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const connection = createRpcConnection({ url: url.href });
    inject(DestroyRef).onDestroy(() => connection.close());
    return createTanstackQueryUtils(connection.client);
  },
});
