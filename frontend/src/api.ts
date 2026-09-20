import { InjectionToken } from "@angular/core";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import type { contract } from "../../shared/contract";

export const API = new InjectionToken<RouterContractClient<typeof contract>>(
  "API",
  {
    providedIn: "root",
    factory: () =>
      createORPCClient(new RPCLink({ origin: location.origin, url: "/rpc" })),
  },
);
