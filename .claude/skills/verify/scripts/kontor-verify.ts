import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { createRpcConnection } from "../../../../frontend/src/rpc-connection.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const root = process.env["KONTOR_VERIFY_ROOT"] ?? "/tmp/kontor-verify";
const repoDb = join(repo, "kontor.sqlite");
const chromePath =
  process.env["KONTOR_VERIFY_CHROME"] ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type Mode = "demo" | "live";
type Run = {
  id: string;
  dir: string;
  evidence: string;
  scratch: string;
  mode: Mode;
  headed: boolean;
  url: string;
  port: number;
  db: string;
  profile: string;
  server: number;
  chrome: number;
  cdp: number;
  repoDbHash: string | null;
  startedAt: string;
  cleanedAt?: string;
};
type Check = { name: string; ok: boolean; detail: string; info?: true };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: "string", default: process.env["KONTOR_VERIFY_RUN"] },
    live: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    build: { type: "boolean", default: false },
    port: { type: "string" },
    text: { type: "string" },
    gone: { type: "boolean", default: false },
    viewport: { type: "boolean", default: false },
    timeout: { type: "string", default: "15000" },
  },
});
const timeout = Number(values.timeout);
const [command, ...args] = positionals;

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function fail(message: string): never {
  process.stderr.write(`kontor-verify: ${message}\n`);
  process.exit(1);
}
function sha256(path: string) {
  return existsSync(path)
    ? createHash("sha256").update(readFileSync(path)).digest("hex")
    : null;
}
function alive(pid: number) {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function sh(file: string, argv: string[]) {
  try {
    return execFileSync(file, argv, { encoding: "utf8" });
  } catch {
    return "";
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, ms: number, probe: () => Promise<T | null> | T | null) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(200);
  }
}
function freePort() {
  return new Promise<number>((done, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address ? done(address.port) : reject(new Error("no port")),
      );
    });
  });
}
function newestMtime(dir: string): { path: string; mtime: number } {
  let newest = { path: dir, mtime: 0 };
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const mtime = statSync(path).mtimeMs;
    if (mtime > newest.mtime) newest = { path, mtime };
  }
  return newest;
}
function buildFreshness() {
  const outputs = ["dist/frontend/browser/index.html", "dist/server/server/index.js"].map((p) =>
    join(repo, p),
  );
  if (outputs.some((p) => !existsSync(p))) return { fresh: false, detail: "no build in dist/" };
  const built = Math.min(...outputs.map((p) => statSync(p).mtimeMs));
  const source = ["frontend/src", "server", "shared"]
    .map((d) => newestMtime(join(repo, d)))
    .reduce((a, b) => (b.mtime > a.mtime ? b : a));
  return source.mtime > built
    ? { fresh: false, detail: `dist/ is older than ${source.path.slice(repo.length + 1)}` }
    : { fresh: true, detail: `dist/ built ${new Date(built).toISOString()}` };
}
function runFile(id: string) {
  return join(root, id, "run.json");
}
function loadRun(): Run {
  if (!values.run) fail("pass --run <id> (printed by launch) or set KONTOR_VERIFY_RUN");
  const file = runFile(values.run);
  if (!existsSync(file)) fail(`no run ${values.run} under ${root}`);
  return JSON.parse(readFileSync(file, "utf8")) as Run;
}
function saveRun(run: Run) {
  writeFileSync(runFile(run.id), `${JSON.stringify(run, null, 2)}\n`);
}
function log(run: Run, entry: Record<string, unknown>) {
  appendFileSync(
    join(run.evidence, "actions.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}
function listeningPid(port: number) {
  return sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).trim().split("\n").filter(Boolean).map(Number);
}
function openFiles(pid: number) {
  return sh("lsof", ["-nP", "-p", String(pid), "-Fn"])
    .split("\n")
    .filter((l) => l.startsWith("n"))
    .map((l) => l.slice(1));
}
function strangers(run: Run) {
  return sh("pgrep", ["-f", run.profile]).trim().split("\n").filter(Boolean).map(Number);
}

async function killGroup(pid: number) {
  if (!alive(pid)) return "not running";
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  const end = Date.now() + 5000;
  while (alive(pid) && Date.now() < end) await sleep(100);
  if (!alive(pid)) return "SIGTERM";
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    process.kill(pid, "SIGKILL");
  }
  await sleep(300);
  return alive(pid) ? "still alive" : "SIGKILL";
}

async function cleanup(run: Run) {
  const chrome = await killGroup(run.chrome);
  const server = await killGroup(run.server);
  for (const pid of strangers(run)) await killGroup(pid);
  const leftovers = strangers(run).filter((pid) => pid !== process.pid);
  const port = listeningPid(run.port);
  rmSync(run.scratch, { recursive: true, force: true });
  run.cleanedAt ??= new Date().toISOString();
  saveRun(run);
  const repoDbHash = sha256(repoDb);
  return {
    run: run.id,
    stopped: { chrome, server },
    leftoverProcesses: leftovers,
    portStillListening: port,
    scratchRemoved: !existsSync(run.scratch),
    repoDbUnchanged: repoDbHash === run.repoDbHash,
    evidence: run.evidence,
    evidenceFiles: existsSync(run.evidence) ? readdirSync(run.evidence).sort() : [],
  };
}

async function launch() {
  if (values.build) execFileSync("npm", ["run", "build"], { cwd: repo, stdio: ["ignore", 2, 2] });
  const build = buildFreshness();
  if (!build.fresh) fail(`${build.detail}. Rerun launch with --build.`);
  if (!existsSync(chromePath)) fail(`Chrome not found at ${chromePath}; set KONTOR_VERIFY_CHROME`);
  const mode: Mode = values.live ? "live" : "demo";
  if (mode === "live" && !existsSync(join(repo, ".env"))) fail("--live needs TYPESAFE_API_KEY in .env");
  const id =
    values.run ?? `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
  if (existsSync(runFile(id))) fail(`run ${id} already exists; pick another --run or clean it up`);
  const dir = join(root, id);
  const scratch = join(dir, "scratch");
  const evidence = join(dir, "evidence");
  mkdirSync(scratch, { recursive: true });
  mkdirSync(evidence, { recursive: true });
  const port = values.port ? Number(values.port) : await freePort();
  const run: Run = {
    id,
    dir,
    evidence,
    scratch,
    mode,
    headed: values.headed,
    url: `http://127.0.0.1:${port}`,
    port,
    db: join(scratch, "kontor.sqlite"),
    profile: join(scratch, "chrome-profile"),
    server: 0,
    chrome: 0,
    cdp: 0,
    repoDbHash: sha256(repoDb),
    startedAt: new Date().toISOString(),
  };
  const env: NodeJS.ProcessEnv = { ...process.env, KONTOR_DB: run.db, PORT: String(port) };
  if (mode === "demo") {
    env["TYPESAFE_MODE"] = "demo";
    delete env["TYPESAFE_API_KEY"];
  } else env["TYPESAFE_MODE"] = "live";
  const server = spawn(
    process.execPath,
    [...(mode === "live" ? ["--env-file=.env"] : []), "dist/server/server/index.js"],
    {
      cwd: repo,
      env,
      detached: true,
      stdio: ["ignore", openSync(join(evidence, "server.log"), "a"), openSync(join(evidence, "server.log"), "a")],
    },
  );
  server.unref();
  run.server = server.pid ?? 0;
  saveRun(run);
  try {
    await until("the server to serve the app", 20000, async () => {
      if (!alive(run.server)) throw new Error(`server exited; see ${join(evidence, "server.log")}`);
      const body = await fetch(run.url).then((r) => (r.ok ? r.text() : ""), () => "");
      return body.includes("<app-root") ? true : null;
    });
    const chrome = spawn(
      chromePath,
      [
        `--user-data-dir=${run.profile}`,
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-search-engine-choice-screen",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--window-size=1280,900",
        ...(run.headed ? [] : ["--headless=new"]),
        run.url,
      ],
      {
        detached: true,
        stdio: ["ignore", openSync(join(evidence, "chrome.log"), "a"), openSync(join(evidence, "chrome.log"), "a")],
      },
    );
    chrome.unref();
    run.chrome = chrome.pid ?? 0;
    saveRun(run);
    run.cdp = await until("Chrome's DevToolsActivePort", 20000, () => {
      const file = join(run.profile, "DevToolsActivePort");
      return existsSync(file) ? Number(readFileSync(file, "utf8").split("\n")[0]) || null : null;
    });
    saveRun(run);
    const footer = await withPage(run, async (page) => {
      const foot = page.locator(".workspace-foot");
      await foot.getByText(/Revision \d+/).waitFor({ timeout: 20000 });
      return foot.innerText();
    });
    log(run, { verb: "launch", mode, url: run.url, footer });
    print({ ready: true, run: run.id, mode, url: run.url, evidence, footer: footer.replace(/\s+/g, " ") });
  } catch (error) {
    const result = await cleanup(run);
    print({ ready: false, error: String(error), cleanup: result });
    process.exit(1);
  }
}

async function doctor(run: Run) {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, info?: true) =>
    checks.push({ name, ok, detail, ...(info ? { info } : {}) });
  add("not cleaned up", !run.cleanedAt, run.cleanedAt ? `cleaned at ${run.cleanedAt}` : "active");
  add("server process alive", alive(run.server), `pid ${run.server}`);
  const listeners = listeningPid(run.port);
  add("port owned by our server", listeners.includes(run.server), `port ${run.port} listeners ${listeners.join(",") || "none"}`);
  const files = alive(run.server) ? openFiles(run.server) : [];
  const runDb = existsSync(run.db) ? realpathSync(run.db) : run.db;
  add("server uses the run database", files.includes(runDb), runDb);
  add("server does not hold the repo kontor.sqlite", !files.some((f) => f.startsWith(realpathSync(repo) + "/kontor.sqlite")), repoDb);
  const body = await fetch(run.url).then((r) => (r.ok ? r.text() : ""), () => "");
  add("app served over HTTP", body.includes("<app-root"), run.url);
  const rpc = createRpcConnection({ url: `ws://127.0.0.1:${run.port}/rpc` });
  try {
    const status = await rpc.client.status();
    add("RPC mode matches launch", status.mode === run.mode, JSON.stringify(status));
    const workspace = await rpc.client.workspace();
    add("workspace revision", true, `revision ${workspace.revision}`, true);
  } catch (error) {
    add("RPC mode matches launch", false, String(error));
  } finally {
    rpc.close();
  }
  if (run.mode === "demo") {
    const outbound = sh("lsof", ["-nP", "-a", "-p", String(run.server), "-iTCP", "-sTCP:ESTABLISHED"])
      .split("\n")
      .slice(1)
      .filter((l) => l && !/->(127\.0\.0\.1|\[::1\])/.test(l));
    add("demo server has no outbound connections", outbound.length === 0, outbound.join(" | ") || "none");
  }
  add("chrome process alive", alive(run.chrome), `pid ${run.chrome}`);
  const version = await fetch(`http://127.0.0.1:${run.cdp}/json/version`).then((r) => r.json(), () => null);
  add("chrome DevTools answers", version !== null, `cdp port ${run.cdp}`);
  const pages = (await fetch(`http://127.0.0.1:${run.cdp}/json/list`).then((r) => r.json(), () => [])) as { url: string }[];
  const tabs = pages.map((p) => p.url).filter((u) => u.startsWith("http"));
  add("a tab shows the app", tabs.some((u) => u.startsWith(run.url)), tabs.join(", ") || "no tabs");
  const build = buildFreshness();
  add("dist/ matches source", build.fresh, build.detail, true);
  const hash = sha256(repoDb);
  add("repo kontor.sqlite unchanged since launch", hash === run.repoDbHash, hash ?? "absent", true);
  const ok = checks.every((c) => c.ok || c.info);
  print({ ok, run: run.id, url: run.url, mode: run.mode, evidence: run.evidence, checks });
  if (!ok) process.exit(1);
}

async function withPage<T>(run: Run, work: (page: Page) => Promise<T>) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${run.cdp}`);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome has no browser context");
    let page = context.pages().find((p) => p.url().startsWith(run.url));
    if (!page) {
      page = await context.newPage();
      await page.goto(run.url);
    }
    page.setDefaultTimeout(timeout);
    return await work(page);
  } finally {
    await browser.close();
  }
}

function evidencePath(run: Run, name: string | undefined, suffix: string) {
  if (!name) fail(`name the ${suffix} file`);
  return join(run.evidence, `${name}${suffix}`);
}

async function browserVerb(run: Run, verb: string | undefined, rest: string[]) {
  const [first, second] = rest;
  let failure = "";
  const result = await withPage(run, async (page): Promise<unknown> => {
    try {
      return await act(page);
    } catch (error) {
      failure = join(run.evidence, `failed-${Date.now()}.png`);
      await page.screenshot({ path: failure, fullPage: true }).catch(() => (failure = ""));
      throw error;
    }
  }).catch((error: unknown) => {
    const message = String(error instanceof Error ? error.message : error)
      .replace(/\u001b\[\d+m/g, "")
      .split("\n")
      .slice(0, 6)
      .join("\n");
    log(run, { verb: `browser ${verb}`, argv: process.argv.slice(3), ok: false, error: message, screenshot: failure || null });
    fail(`browser ${verb} failed${failure ? ` (screenshot ${failure})` : ""}\n${message}`);
  });
  log(run, { verb: `browser ${verb}`, argv: process.argv.slice(3), ok: true, result });
  print(result);

  async function act(page: Page): Promise<unknown> {
    switch (verb) {
      case "goto":
        await page.goto(new URL(first ?? "/", run.url).href);
        return page.url();
      case "click":
        await page.locator(need(first, "selector")).click();
        return "clicked";
      case "fill":
        await page.locator(need(first, "selector")).fill(need(second, "value"));
        return "filled";
      case "press":
        await page.keyboard.press(need(first, "key"));
        return "pressed";
      case "command": {
        const request = page.getByRole("textbox", { name: "Auftrag an Jev" });
        if (!(await request.isVisible())) await page.locator(".command-trigger").click();
        await request.fill(need(first, "request text"));
        await page.locator(".palette form button[type=submit]").click();
        return "submitted";
      }
      case "wait": {
        const locator = page.locator(need(first, "selector"));
        if (values.gone) {
          await locator.first().waitFor({ state: "hidden" });
          return "gone";
        }
        const text = values.text;
        if (text === undefined) {
          await locator.first().waitFor();
          return "visible";
        }
        return until(`${first} to contain ${JSON.stringify(text)}`, timeout, async () => {
          const texts = await locator.allInnerTexts();
          return texts.some((t) => t.includes(text)) ? texts : null;
        });
      }
      case "text":
        return page.locator(need(first, "selector")).allInnerTexts();
      case "eval":
        return page.evaluate(need(first, "expression"));
      case "snapshot": {
        const path = evidencePath(run, first, ".aria.yml");
        writeFileSync(path, await page.locator("body").ariaSnapshot());
        return path;
      }
      case "screenshot": {
        const path = evidencePath(run, first, ".png");
        await page.screenshot({ path, fullPage: !values.viewport });
        return path;
      }
      default:
        fail(`unknown browser verb ${verb}; see SKILL.md`);
    }
  }
}
function need(value: string | undefined, what: string) {
  if (value === undefined) fail(`missing ${what}`);
  return value;
}

function state(run: Run, name: string | undefined) {
  if (!existsSync(run.db)) fail(`no database at ${run.db}`);
  const db = new DatabaseSync(run.db, { readOnly: true });
  try {
    const row = db.prepare("SELECT data FROM workspace WHERE id=1").get();
    const workspace = JSON.parse(String(row?.["data"]));
    const receipts = db
      .prepare("SELECT id, data FROM receipts")
      .all()
      .map((r) => {
        const receipt = JSON.parse(String(r["data"]));
        return { operationId: r["id"], caseId: receipt.caseId, revision: receipt.revision };
      });
    const snapshot = { db: run.db, revision: workspace.revision, receipts, cases: workspace.cases };
    if (name) writeFileSync(evidencePath(run, name, ".state.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
    log(run, { verb: "state", name, revision: workspace.revision, receipts: receipts.length });
    print(snapshot);
  } finally {
    db.close();
  }
}

function list() {
  if (!existsSync(root)) return print([]);
  print(
    readdirSync(root)
      .filter((id) => existsSync(runFile(id)))
      .map((id) => {
        const run = JSON.parse(readFileSync(runFile(id), "utf8")) as Run;
        return {
          run: id,
          mode: run.mode,
          url: run.url,
          serverAlive: alive(run.server),
          chromeAlive: alive(run.chrome),
          cleanedAt: run.cleanedAt ?? null,
          evidence: run.evidence,
        };
      }),
  );
}

switch (command) {
  case "launch":
    await launch();
    break;
  case "doctor":
    await doctor(loadRun());
    break;
  case "browser":
    await browserVerb(loadRun(), args[0], args.slice(1));
    break;
  case "state":
    state(loadRun(), args[0]);
    break;
  case "cleanup": {
    const result = await cleanup(loadRun());
    print(result);
    if (result.leftoverProcesses.length || result.portStillListening.length) process.exit(1);
    break;
  }
  case "list":
    list();
    break;
  default:
    fail("usage: kontor-verify launch|doctor|browser|state|cleanup|list (see .claude/skills/verify/SKILL.md)");
}
