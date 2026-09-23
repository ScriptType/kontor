---
name: verify
description: Launch and drive Kontor Service (Angular UI plus Hono/oRPC server, Jev command palette) in an isolated headless Chrome the way a user does, then prove the result with screenshots, ARIA snapshots, and a read of the run's own SQLite database. Use to confirm a UI, palette, case-editing, filter, or reset change works in the real built app, or to reproduce a bug on the user-facing surface before fixing it.
---

# Verify Kontor in the real app

Every command below runs from the repo root through one helper, `.claude/skills/verify/scripts/kontor-verify`. It starts the built app (`dist/`) on a free port with its own database and its own Chrome profile, so it never touches the user's `kontor.sqlite`, their `npm run dev` instance on ports 3000/4200, or their browser. Two runs can go side by side.

Read [features/README.md](features/README.md) before driving, then the feature file that matches your change.

## Launch

```sh
.claude/skills/verify/scripts/kontor-verify launch            # demo mode, headless
.claude/skills/verify/scripts/kontor-verify launch --build    # rebuild dist/ first (npm run build)
.claude/skills/verify/scripts/kontor-verify launch --headed   # visible Chrome window
.claude/skills/verify/scripts/kontor-verify launch --run my-id --port 4310
```

- Launch refuses to start when `dist/` is older than any file in `frontend/src`, `server`, or `shared`. Rerun with `--build`. The build rewrites the shared `dist/`, which only the user's `npm start` serves.
- Ready means launch printed `"ready": true`. It checks three things first: the server answers `GET /` with `<app-root`, Chrome wrote `DevToolsActivePort`, and the page footer shows `Gespeicherter Datenstand · Revision N`. Launch output names the `run` id. Every later command needs `--run <id>` (or `KONTOR_VERIFY_RUN=<id>` on the same command line, because shell state does not persist between tool calls).
- A failed launch tears down what it started and prints the cleanup result. The server and Chrome logs stay in the evidence directory.
- What launch runs is `node dist/server/server/index.js` with `TYPESAFE_MODE=demo`, `KONTOR_DB=<run>/scratch/kontor.sqlite`, and `PORT=<free port>`. It never reads `.env`. That matters: the user's `.env` sets `TYPESAFE_MODE=live` with a real key, so `npm start` and `npm run dev:server` would call Jev and write the repo's `kontor.sqlite`. Never verify through them.
- `--live` adds `--env-file=.env`, so the server calls the real Jev with the user's key. That costs provider calls and money. Use it only when the user asked for a live check. Demo mode proves app mechanics with fixed decisions. It does not prove Jev's language understanding (see [docs/jev-live.md](../../../docs/jev-live.md) and `npm run test:live` for budgeted live runs).
- Teardown is `cleanup` (below). There is no other supported way to stop a run.

## Doctor

```sh
.claude/skills/verify/scripts/kontor-verify doctor --run <id>
```

Read-only. Exit 0 means the instance is worth driving. It prints JSON checks. The server and Chrome PIDs are alive. The port listener is our server PID. `lsof` shows the server holding the run's database and not the repo's `kontor.sqlite`. The app answers over HTTP. The oRPC `status` call over the WebSocket reports the launched mode. In demo mode, the server has no non-loopback TCP connections, which is how you know demo made no provider call. Chrome's DevTools endpoint answers with a tab on the run URL. Two checks are info only: whether `dist/` still matches source, and whether the repo `kontor.sqlite` hash equals the one taken at launch. The second can change when the user's own instance writes it. Run doctor first whenever anything looks off, and again after driving if you claim demo made no network calls.

## Drive

```sh
K=.claude/skills/verify/scripts/kontor-verify
$K browser --run <id> command "Weise V-1042 Lea Sommer zu und speichere."
$K browser --run <id> wait .activity-label --text "Jev meldet den Auftrag als erledigt"
$K browser --run <id> click '[data-action="case:V-1041"]'
$K browser --run <id> fill '[data-field="minutes"]' 60
$K browser --run <id> click 'role=button[name="Jetzt zurücksetzen"s]'
$K browser --run <id> text '.editor-footer [role=status]'
$K browser --run <id> eval 'localStorage.getItem("kontor-command-v1")'
$K state --run <id>
```

Each `browser` call connects to the run's Chrome over CDP, acts on the tab showing the app, and disconnects. The tab and its state survive between calls. Verbs:

| Verb | Arguments | Does |
| --- | --- | --- |
| `goto` | `[path]` | Loads the app URL (or a path under it). A reload keeps server data and browser storage. |
| `click` | `<selector>` | Clicks one element. Fails if the selector matches several or the element stays disabled. |
| `fill` | `<selector> <value>` | Replaces an input's value like typing. |
| `press` | `<key>` | Keyboard press on the focused element, for example `Escape` or `Meta+k`. |
| `command` | `<request text>` | Opens the palette (`Jev · Befehl eingeben`), fills `Auftrag an Jev`, and submits. |
| `wait` | `<selector> [--text t] [--gone]` | Waits until the element is visible, contains `t`, or is hidden. |
| `text` | `<selector>` | Prints the inner text of every match. |
| `eval` | `<js expression>` | Prints the value. Use it to read, never to change app state. |
| `screenshot` | `<name> [--viewport]` | PNG to `evidence/<name>.png`, full page unless `--viewport`. |
| `snapshot` | `<name>` | ARIA snapshot of the page to `evidence/<name>.aria.yml`. |

Options for any `browser` verb: `--timeout <ms>` (default 15000). A failed verb exits 1, prints Playwright's call log, and saves `evidence/failed-<ms>.png`.

Selectors are Playwright selector strings. Prefer these stable handles, in this order:

- `[data-action="<id>"]` for every button Jev can press. Ids follow `nav:cases|customers|team|reports`, `case:V-1042`, `filter:all|open|done`, `filter:reset`, `menu:customer`, `customer:nord|hafen|linden|all`, `menu:filter-technician`, `filter-technician:lea|jonas|mara|all`, `menu:technician`, `technician:lea|jonas|mara`, `priority:Hoch|Normal`, `save`, `discard`, `close`, `complete`, `reopen`, `remove-appointment`, `menu:open-case`, `open-case:V-1041`, `customer-cases:nord`, `technician-cases:lea`. List the ids on screen with `eval '[...document.querySelectorAll("[data-action]")].map(e => e.dataset.action).join(" ")'`.
- `[data-field="<id>"]` for inputs: `search`, `minutes`, `appointment`, `duration`.
- ARIA roles with exact names (the trailing `s` makes the match exact and case-sensitive): `role=searchbox[name="Vorgänge durchsuchen"s]`, `role=button[name="Demodaten zurücksetzen"s]`, `role=dialog`.
- Classes only where the app has no other handle: `.activity-label` (Jev status line), `.editor h2` (open case title), `.editor-footer [role=status]` (save state), `.workspace-foot` (mode and revision), `.answer-panel [data-answer-part="value"]` and `[data-answer-submit]` (missing-value answer).

Seed data at launch is revision 0 with cases V-1042 (Nordwerk, Jonas Weber, 0 min, Hoch), V-1041 (Hafen & Partner, Jonas Weber, 45 min, Normal, appointment 2026-09-24 09:00), V-1039 (Nordwerk, Lea Sommer, 30 min, Hoch, needs an inspection note), V-1037 (Lindenwerk, Mara Schulz, 20 min), V-1035 (Hafen & Partner, Mara Schulz, 90 min, done). A reset restores these cases at the next revision.

Demo mode answers only the five texts in `shared/command.ts` `demos`. Any other text makes Jev abstain without acting. Type them exactly.

- `Zeig mir die Kunden.`
- `Zeige zuerst Kunden, danach Berichte und zuletzt Team.`
- `Weise V-1042 Lea Sommer zu und speichere.`
- `Erfasse 45 Minuten für V-1042 und speichere.`
- `Erfasse Arbeitszeit für V-1042 und speichere.`

Playwright MCP tools can also drive the run: navigate the MCP browser to the run URL from launch. That browser has its own profile, so it does not see the run's localStorage. Use the helper for evidence.

For behavior that only live Jev produces (answer prefill, reviews, duels), demo mode cannot reach it. The existing specs drive the real UI against a scripted provider at the Jev HTTP boundary with an in-memory store. See [features/missing-value.md](features/missing-value.md).

## Evidence

Everything lands in `/tmp/kontor-verify/<run>/evidence/`, outside the repo (override the root with `KONTOR_VERIFY_ROOT`). Cleanup keeps this directory.

- `actions.jsonl` logs every launch, browser verb, and state read with its arguments, result, and time. It is the action trail.
- `server.log` and `chrome.log` hold process output.
- `<name>.png`, `<name>.aria.yml`, and `<name>.state.json` come from `screenshot`, `snapshot`, and `state <name>`.
- A full-page screenshot draws the fixed sidebar and the Jev status bar where the viewport ends, so they can cover a table row halfway down the image. That is a capture artifact, not a layout bug. Judge layout from `screenshot <name> --viewport`.

Proof standards for this app:

- Drive the user path. Start Jev work through `command`, and do manual work through `data-action` and `data-field` handles. Never call oRPC `saveCase` or `resetWorkspace` directly, and never edit the run database, to set up or prove a result.
- Capture the action and the resulting state. A proof has the `actions.jsonl` lines, a screenshot and ARIA snapshot after the action, and a `state <name>` file.
- Check the side effect in the database, not only the screen. `state` opens the run's SQLite read-only and prints `revision`, the `receipts` rows, and every case. A save adds one receipt and raises `revision` by one. A draft or a navigation changes neither. A reset raises `revision`, restores the seed cases, and keeps the receipts.
- A status text alone is not proof. `V-1042 gespeichert` or `Jev meldet den Auftrag als erledigt` must match the stored case.
- In demo mode, rerun `doctor` after driving. Its outbound-connection check shows that demo made no provider call.
- Report the run id, the evidence directory, and the feature and sub-feature ids from the map that you exercised.

## Cleanup

```sh
.claude/skills/verify/scripts/kontor-verify cleanup --run <id>
.claude/skills/verify/scripts/kontor-verify list        # every run under /tmp/kontor-verify, alive or not
```

Cleanup stops the Chrome and server process groups that launch recorded (SIGTERM, then SIGKILL after 5 s). It also stops any leftover process whose command line contains the run's own Chrome profile path. It never kills by process name. It then deletes `<run>/scratch` (database and Chrome profile) and keeps `<run>/evidence` and `<run>/run.json`. It prints `leftoverProcesses`, `portStillListening`, `repoDbUnchanged`, and the evidence file list, and exits 1 if a process or the port survived. It is safe to run twice. Run it after every attempt, failed ones included. Use `list` to find runs a crashed session left behind.

## Helpers

- `scripts/kontor-verify` is the entry point. This bash wrapper changes to the repo root and runs `kontor-verify.ts` through the repo's `tsx`.
- `scripts/kontor-verify.ts` implements `launch`, `doctor`, `browser`, `state`, `cleanup`, and `list`. It uses the repo's `@playwright/test` (system Chrome at `/Applications/Google Chrome.app`, override with `KONTOR_VERIFY_CHROME`), `node:sqlite`, and `frontend/src/rpc-connection.ts` for the doctor's RPC calls.
