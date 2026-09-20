import { Injectable, computed, inject, signal } from "@angular/core";
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { z } from "zod";
import { readBrowserState, writeBrowserState } from "./browser-state";
import { ORPC } from "./api";
import {
  blockers,
  draftOf,
  saveSchema,
  type CaseDraft,
  type Receipt,
  type Save,
} from "../../shared/domain";
import type { Actor } from "./action-registry";
const saveJournalSchema = saveSchema.extend({
  runId: z.string().nullable().default(null),
});
const pageSchema = z.enum(["cases", "customers", "team", "reports"]);
export type Page = z.infer<typeof pageSchema>;
@Injectable({ providedIn: "root" })
export class WorkspaceUi {
  readonly api = inject(ORPC);
  private readonly queries = inject(QueryClient);
  readonly query = injectQuery(() =>
    this.api.workspace.queryOptions({
      retry: false,
      networkMode: "always",
      staleTime: 0,
      refetchOnWindowFocus: false,
    }),
  );
  readonly source = injectQuery(() =>
    this.api.status.queryOptions({ retry: false, staleTime: Infinity }),
  );
  readonly mutation = injectMutation(() =>
    this.api.saveCase.mutationOptions({ retry: false, networkMode: "always" }),
  );
  readonly data = computed(() => this.query.data());
  readonly page = signal<Page>(
    pageSchema.catch("cases").parse(location.hash.slice(1)),
  );
  readonly customer = signal("all");
  readonly openOnly = signal(false);
  readonly search = signal("");
  readonly menu = signal<"customer" | "technician" | null>(null);
  readonly evidenceFocus = signal<string | null>(null);
  readonly detailFocus = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly draft = signal<CaseDraft | null>(null);
  readonly draftOwner = signal<Actor | null>(null);
  readonly draftRevision = signal(0);
  readonly message = signal("");
  readonly busy = signal(false);
  readonly selected = computed(() =>
    this.data()?.cases.find((c) => c.id === this.selectedId()),
  );
  readonly dirty = computed(() => {
    const c = this.selected();
    return !!c && JSON.stringify(draftOf(c)) !== JSON.stringify(this.draft());
  });
  readonly filtered = computed(() =>
    (this.data()?.cases ?? []).filter(
      (c) =>
        (this.customer() === "all" || c.customerId === this.customer()) &&
        (!this.openOnly() || c.status === "open") &&
        `${c.id} ${c.title} ${this.customerName(c.customerId)}`
          .toLowerCase()
          .includes(this.search().toLowerCase()),
    ),
  );
  readonly blocked = computed(() => {
    const data = this.data(),
      c = this.selected(),
      draft = this.draft();
    return data && c && draft ? blockers(data, { ...c, ...draft }) : [];
  });
  private generation = 0;
  readonly resetting = signal(false);
  pending: Promise<void> = Promise.resolve();
  beforeManual: () => void = () => {};
  onSave: (input: Save) => void = () => {};
  currentRunId: () => string | null = () => null;
  onReceipt: (receipt: Receipt, runId: string | null, actor: Actor) => boolean =
    () => true;
  readonly unknownSave = signal<z.infer<typeof saveJournalSchema> | null>(
    this.restoreUnknown(),
  );
  constructor() {
    window.addEventListener("hashchange", () =>
      this.navigate(
        pageSchema.catch("cases").parse(location.hash.slice(1)),
        "manual",
      ),
    );
  }
  customerName(id: string) {
    return this.data()?.customers.find((c) => c.id === id)?.name ?? id;
  }
  technicianName(id: string) {
    return this.data()?.technicians.find((t) => t.id === id)?.name ?? id;
  }
  manual() {
    this.cancelFocus();
    this.beforeManual();
  }
  cancelFocus() {
    this.detailFocus.set(null);
    this.evidenceFocus.set(null);
  }
  navigate(page: Page, actor: Actor) {
    this.cancelFocus();
    if (actor === "manual") this.manual();
    this.page.set(page);
    history.replaceState(null, "", "#" + page);
    this.menu.set(null);
  }
  openCase(id: string, actor: Actor) {
    if (actor === "manual") this.manual();
    if (this.dirty() && this.selectedId() !== id) {
      this.message.set(
        "Bitte den offenen Entwurf zuerst speichern oder verwerfen.",
      );
      return;
    }
    const c = this.data()?.cases.find((c) => c.id === id);
    if (!c) return;
    if (!this.dirty()) {
      this.selectedId.set(id);
      this.draft.set(draftOf(c));
      this.draftOwner.set(null);
      this.draftRevision.set(this.data()?.revision ?? 0);
      this.message.set("");
    }
    this.menu.set(null);
    this.evidenceFocus.set(null);
    this.detailFocus.set(id);
  }
  edit(patch: Partial<CaseDraft>, actor: Actor) {
    this.draftOwner.set(actor);
    if (actor === "manual") this.manual();
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
    this.message.set("Ungespeicherter Entwurf");
  }
  discard(actor: Actor = "manual") {
    if (actor === "manual") this.manual();
    const c = this.selected();
    if (c) {
      this.draft.set(draftOf(c));
      this.draftRevision.set(this.data()?.revision ?? 0);
      this.draftOwner.set(null);
    }
    this.message.set("Entwurf verworfen");
  }
  closeCase(actor: Actor = "manual") {
    this.cancelFocus();
    if (actor === "manual") this.manual();
    if (this.dirty()) {
      this.message.set(
        "Der Entwurf bleibt offen. Zuerst speichern oder verwerfen.",
      );
      return;
    }
    this.selectedId.set(null);
    this.draft.set(null);
  }
  save(actor: Actor) {
    if (actor === "manual") this.manual();
    const draft = this.draft(),
      caseId = this.selectedId();
    if (!draft || !caseId || this.busy() || this.unknownSave()) return;
    const input: Save = {
      operationId: crypto.randomUUID(),
      revision: this.draftRevision(),
      caseId,
      draft: structuredClone(draft),
      actor,
    };
    const journal = {
      ...input,
      runId: actor === "jev" ? this.currentRunId() : null,
    };
    if (!writeBrowserState("kontor-save-v1", journal)) {
      this.message.set(
        "Lokales Speicherprotokoll nicht verfügbar. Speichern wurde nicht gesendet.",
      );
      return;
    }
    this.unknownSave.set(journal);
    this.busy.set(true);
    this.onSave(input);
    const generation = this.generation;
    this.pending = this.commit(input, generation).finally(() => {
      if (generation === this.generation) this.busy.set(false);
    });
  }
  private async commit(input: Save, generation: number) {
    try {
      await this.accept(await this.mutation.mutateAsync(input), generation);
    } catch (error) {
      if (generation !== this.generation) return;
      const result = await this.api.receipt
        .call({ operationId: input.operationId })
        .catch(() => undefined);
      if (generation !== this.generation) return;
      if (result) {
        await this.accept(result, generation);
        return;
      }
      if (result === null) {
        this.unknownSave.set(null);
        writeBrowserState("kontor-save-v1", null);
        await this.refresh();
        if (generation !== this.generation) return;
        this.message.set(
          error instanceof Error ? error.message : "Speichern abgelehnt.",
        );
      } else
        this.message.set(
          "Speicherergebnis unbekannt. Vor weiteren Änderungen Ergebnis prüfen.",
        );
    }
  }
  async reconcile() {
    if (this.resetting()) return;
    const generation = this.generation;
    const input = this.unknownSave();
    if (!input) return;
    this.busy.set(true);
    try {
      const receipt = await this.api.receipt.call({
        operationId: input.operationId,
      });
      if (generation !== this.generation) return;
      if (receipt) await this.accept(receipt, generation);
      else {
        this.unknownSave.set(null);
        writeBrowserState("kontor-save-v1", null);
        await this.refresh();
        if (generation !== this.generation) return;
        this.message.set(
          "Keine Speicherung gefunden. Der Auftrag wurde nicht erneut gesendet.",
        );
      }
    } catch {
      if (generation !== this.generation) return;
      this.message.set("Ergebnis noch unbekannt. Verbindung prüfen.");
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  private async accept(receipt: Receipt, generation: number) {
    if (generation !== this.generation) return;
    const submitted = this.unknownSave();
    const unchangedDraft =
      submitted?.operationId === receipt.operationId &&
      JSON.stringify(this.draft()) === JSON.stringify(submitted.draft);
    const current = this.data();
    if (current && current.revision <= receipt.revision)
      this.queries.setQueryData(this.api.workspace.queryKey(), {
        ...current,
        revision: receipt.revision,
        cases: current.cases.map((c) =>
          c.id === receipt.caseId ? receipt.saved : c,
        ),
      });
    if (
      this.selectedId() === receipt.caseId &&
      (!current || current.revision <= receipt.revision)
    ) {
      if (unchangedDraft) this.draft.set(draftOf(receipt.saved));
      this.draftRevision.set(receipt.revision);
    }
    const recorded = this.onReceipt(
      receipt,
      submitted?.runId ?? null,
      submitted?.actor ?? "manual",
    );
    if (recorded) {
      this.unknownSave.set(null);
      writeBrowserState("kontor-save-v1", null);
    }
    const savedBase =
      current && current.revision > receipt.revision
        ? (current.cases.find((c) => c.id === receipt.caseId) ?? receipt.saved)
        : receipt.saved;
    const draft = this.draft();
    const newerDraft =
      this.selectedId() === receipt.caseId &&
      draft !== null &&
      JSON.stringify(draft) !== JSON.stringify(draftOf(savedBase));
    this.message.set(
      recorded
        ? `${receipt.caseId} gespeichert${newerDraft ? " · neuerer Entwurf bleibt ungespeichert" : ""}`
        : `${receipt.caseId} gespeichert · Zuordnung zum Auftrag noch nicht gesichert. Ergebnis erneut prüfen.`,
    );
    await this.refresh().catch(() => {
      if (generation !== this.generation) return;
      this.message.set(
        `${receipt.caseId} gespeichert · weitere Daten konnten nicht aktualisiert werden`,
      );
    });
  }
  async refresh() {
    if (this.resetting()) return;
    const generation = this.generation;
    const draft = this.draft();
    const pristine = !this.dirty();
    await this.query.refetch({ throwOnError: true });
    if (generation !== this.generation) return;
    const selected = this.selected();
    if (pristine && this.draft() === draft && selected) {
      this.draft.set(draftOf(selected));
      this.draftRevision.set(this.data()?.revision ?? 0);
    }
  }
  async reset() {
    if (this.resetting()) return;
    this.cancelFocus();
    this.generation++;
    this.resetting.set(true);
    this.busy.set(false);
    this.pending = Promise.resolve();
    try {
      await this.queries.cancelQueries({
        queryKey: this.api.workspace.queryKey(),
      });
      const current = await this.api.workspace.call();
      const workspace = await this.api.resetWorkspace.call({
        expectedRevision: current.revision,
      });
      this.queries.setQueryData(this.api.workspace.queryKey(), workspace);
      this.unknownSave.set(null);
      this.selectedId.set(null);
      this.draft.set(null);
      this.draftOwner.set(null);
      this.draftRevision.set(workspace.revision);
      this.customer.set("all");
      this.openOnly.set(false);
      this.search.set("");
      this.menu.set(null);
      this.evidenceFocus.set(null);
      this.page.set("cases");
      history.replaceState(null, "", "#cases");
      this.message.set("");
      return writeBrowserState("kontor-save-v1", null);
    } catch (error) {
      const current = await this.api.workspace.call().catch(() => null);
      if (current)
        this.queries.setQueryData(this.api.workspace.queryKey(), current);
      throw error;
    } finally {
      this.resetting.set(false);
    }
  }
  private restoreUnknown() {
    const parsed = saveJournalSchema.safeParse(
      readBrowserState("kontor-save-v1"),
    );
    return parsed.success ? parsed.data : null;
  }
}
