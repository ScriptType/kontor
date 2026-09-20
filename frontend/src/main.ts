import { LOCALE_ID } from "@angular/core";
import { registerLocaleData } from "@angular/common";
import localeDe from "@angular/common/locales/de";
import { bootstrapApplication } from "@angular/platform-browser";
import {
  provideTanStackQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { App } from "./app";

registerLocaleData(localeDe);
bootstrapApplication(App, {
  providers: [
    provideTanStackQuery(new QueryClient()),
    { provide: LOCALE_ID, useValue: "de" },
  ],
}).catch(() => {
  document.body.textContent =
    "Die Anwendung konnte nicht gestartet werden. Bitte neu laden.";
});
