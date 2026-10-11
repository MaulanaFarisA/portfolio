#!/usr/bin/env node
/**
 * verify-stack.mjs — Zero-dependency CDP probe for the Stack page (§6.6).
 *
 * Asserts: 4 category cards (Languages/Frameworks/Tools/Infra), each with a
 * grid of items; every item = decorative pixel icon (inline SVG, crispEdges,
 * aria-hidden) + tech name + level; numbering 1..16 continuous and unique;
 * single h1; responsive at 375px.
 *
 * Ports: server 3109, CDP 9232 (task-9/10 worker allocation). Build runs
 * under the shared build.lock; server detached, stdio to file, tree-kill on
 * every exit path.
 *
 * Usage: node scripts/verify-stack.mjs [--skip-build]
 * Exits 0 on all-pass, 1 on any mismatch.
 */
import { execSync, spawn } from "node:child_process";
import {
  mkdtempSync, rmSync, openSync, closeSync, existsSync, mkdirSync,
  readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3109;
const CDP_PORT = 9232;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = join(import.meta.dirname, "..");
const EVIDENCE_DIR = join(ROOT, "..", ".omo", "evidence");
const LOCK = "C:\\Users\\FARIS\\.omo\\start-work\\build.lock";
const URL_STACK = `http://localhost:${PORT}/stack`;
const SKIP_BUILD = process.argv.includes("--skip-build");

if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
const serverLogFd = openSync(join(EVIDENCE_DIR, "task-10-server.log"), "w");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const syncSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function acquireLock() {
  const deadline = Date.now() + 40 * 60 * 1000;
  for (;;) {
    try {
      closeSync(openSync(LOCK, "wx"));
      console.log("[lock] acquired build.lock");
      return true;
    } catch {
      if (Date.now() > deadline) {
        console.error("[lock] TIMEOUT after 40min");
        process.exit(1);
      }
      console.log("[lock] busy, retry in 20s...");
      syncSleep(20000);
    }
  }
}
function releaseLock() {
  try { rmSync(LOCK, { force: true }); console.log("[lock] released build.lock"); } catch {}
}

let nextId = 1;
function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
    const handler = (ev) => {
      const msg = JSON.parse(typeof ev === "string" ? ev : ev.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
        clearTimeout(timeout);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function cdpEval(ws, expression) {
  const res = await cdpSend(ws, "Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

let serverProc = null;
let chromeProc = null;
let chromeTmpDir = null;

function killTree(pid) {
  if (!pid) return;
  try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {}
}
async function waitPortFree(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${port}/`); await sleep(500); }
    catch { console.log(`[cleanup] port ${port} free`); return true; }
  }
  console.warn(`[cleanup] port ${port} still occupied after ${timeoutMs}ms`);
  return false;
}
async function cleanup() {
  console.log("[cleanup] killing process trees...");
  killTree(chromeProc?.pid);
  killTree(serverProc?.pid);
  if (chromeProc) chromeProc.killed = true;
  if (serverProc) serverProc.killed = true;
  await waitPortFree(PORT, 10000);
  await waitPortFree(CDP_PORT, 5000);
  try { if (chromeTmpDir) rmSync(chromeTmpDir, { recursive: true, force: true }); } catch {}
  console.log("[cleanup] chrome profile removed:", chromeTmpDir ?? "none");
}
process.on("exit", () => { killTree(chromeProc?.pid); killTree(serverProc?.pid); });
process.on("SIGINT", () => { cleanup().then(() => process.exit(1)); });
process.on("SIGTERM", () => { cleanup().then(() => process.exit(1)); });

let failures = 0;
const results = {};
function assert(name, condition, details) {
  if (condition) {
    results[name] = { pass: true, details };
    console.log(`  ✓ ${name}`);
  } else {
    results[name] = { pass: false, details };
    console.log(`  ✗ ${name}: ${details}`);
    failures++;
  }
}

const computed = { probe: "verify-stack", startedAt: new Date().toISOString() };

try {
  try {
    await fetch(`http://127.0.0.1:${PORT}/`);
    console.warn(`[probe] port ${PORT} occupied before start — aborting`);
    process.exit(1);
  } catch { console.log(`[probe] port ${PORT} free`); }

  if (!SKIP_BUILD) {
    acquireLock();
    console.log("[probe] Building (under lock)...");
    const t0 = Date.now();
    try {
      execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
    } finally {
      releaseLock();
    }
    computed.buildDurationMs = Date.now() - t0;
    console.log(`[probe] Build done in ${computed.buildDurationMs}ms`);
  } else {
    console.log("[probe] --skip-build: serving existing .next");
  }
  computed.buildId = existsSync(join(ROOT, ".next", "BUILD_ID"))
    ? readFileSync(join(ROOT, ".next", "BUILD_ID"), "utf8").trim()
    : null;

  console.log("[probe] Starting DETACHED server on port", PORT);
  serverProc = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    { cwd: ROOT, stdio: ["ignore", serverLogFd, serverLogFd], detached: true }
  );
  serverProc.unref();

  let serverUp = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) { serverUp = true; break; }
    } catch {}
  }
  if (!serverUp) { console.error("[probe] Server did not start"); await cleanup(); process.exit(1); }
  console.log("[probe] Server ready");

  const httpRes = await fetch(URL_STACK);
  assert("http-stack-200", httpRes.status === 200, `status=${httpRes.status}`);
  const html = await httpRes.text();
  assert("ssr-h1-in-payload", html.includes(">Stack<"), "server HTML contains h1 text");
  assert("ssr-tech-name-in-payload", html.includes("TypeScript"), "first tech name in SSR payload");

  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-stack-probe-"));
  chromeProc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeTmpDir}`,
    "--disable-gpu", "--no-sandbox",
    "--window-size=1440,900",
  ], { stdio: "ignore", detached: true });
  chromeProc.unref();
  await sleep(2000);

  let wsUrl;
  for (let i = 0; i < 15; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await resp.json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(500);
  }
  if (!wsUrl) { console.error("[probe] Chrome CDP not reachable"); await cleanup(); process.exit(1); }
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  await cdpSend(ws, "Page.enable");
  await cdpSend(ws, "Runtime.enable");

  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await cdpSend(ws, "Page.navigate", { url: URL_STACK });
  await sleep(3000);

  const struct = await cdpEval(ws, `(() => {
    const h1s = Array.from(document.querySelectorAll("h1"));
    const grid = document.querySelector('[data-testid="stack-grid"]');
    const cards = grid ? Array.from(grid.children) : [];
    const categories = cards.map((card) => {
      const list = card.querySelector("ul");
      const title = list?.getAttribute("aria-label") ?? null;
      const items = list ? Array.from(list.querySelectorAll(":scope > li")) : [];
      return {
        title,
        itemCount: items.length,
        names: items.map((li) => li.querySelector(".stack-item__name")?.textContent ?? null),
        levels: items.map((li) => li.querySelector(".stack-item__level")?.textContent ?? null),
        iconSvgs: list ? list.querySelectorAll("svg").length : 0,
        iconHiddenWrappers: list ? Array.from(list.querySelectorAll(".stack-item__icon")).every((el) => el.getAttribute("aria-hidden") === "true") : false,
        crispEdges: list ? Array.from(list.querySelectorAll("svg")).every((s) => s.getAttribute("shape-rendering") === "crispEdges") : false,
        svgHidden: list ? Array.from(list.querySelectorAll("svg")).every((s) => s.getAttribute("aria-hidden") === "true" && s.getAttribute("focusable") === "false") : false,
      };
    });
    const main = document.querySelector("main");
    return {
      h1Count: h1s.length,
      h1Text: h1s[0]?.textContent?.trim() ?? null,
      title: document.title,
      cardCount: cards.length,
      categories,
      mainText: main?.textContent ?? "",
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    };
  })()`);
  computed.structure = struct;

  assert("single-h1", struct.h1Count === 1, `count=${struct.h1Count}`);
  assert("h1-text-stack", struct.h1Text === "Stack", `text="${struct.h1Text}"`);
  assert("title-template", struct.title === "Stack - Maulana Faris", `title="${struct.title}"`);
  assert("four-category-cards", struct.cardCount === 4, `cards=${struct.cardCount}`);
  assert("category-titles",
    JSON.stringify(struct.categories.map((c) => c.title)) === JSON.stringify(["Languages", "Frameworks", "Tools", "Infra"]),
    `titles=${JSON.stringify(struct.categories.map((c) => c.title))}`);

  const allNames = struct.categories.flatMap((c) => c.names);
  const expectedNames = [
    "TypeScript", "JavaScript", "Python", "SQL",
    "Next.js", "React", "Tailwind CSS", "Node.js",
    "Git", "Docker", "Vitest", "Aseprite",
    "Vercel", "Supabase", "PostgreSQL", "GitHub Actions",
  ];
  assert("16-items-total", allNames.length === 16, `items=${allNames.length}`);
  assert("tech-names-1-16-continuous",
    JSON.stringify(allNames) === JSON.stringify(expectedNames),
    `names=${JSON.stringify(allNames).slice(0, 120)}`);
  assert("tech-name-slots-unique", new Set(allNames).size === allNames.length,
    `unique=${new Set(allNames).size}`);

  const allLevels = struct.categories.flatMap((c) => c.levels);
  const expectedLevels = [
    "production", "production", "working", "working",
    "production", "production", "production", "working",
    "production", "working", "working", "working",
    "production", "production", "working", "working",
  ];
  assert("levels-1-16-present",
    JSON.stringify(allLevels) === JSON.stringify(expectedLevels),
    `levels=${JSON.stringify(allLevels).slice(0, 120)}`);

  assert("icons-per-item-16", struct.categories.every((c) => c.iconSvgs === c.itemCount),
    `per-category=${JSON.stringify(struct.categories.map((c) => c.iconSvgs))}`);
  assert("icon-wrappers-aria-hidden", struct.categories.every((c) => c.iconHiddenWrappers),
    "all .stack-item__icon wrappers aria-hidden");
  assert("icons-crisp-edges", struct.categories.every((c) => c.crispEdges),
    "shape-rendering=crispEdges on every svg");
  assert("icons-decorative-hidden", struct.categories.every((c) => c.svgHidden),
    'aria-hidden="true" + focusable="false" on every decorative svg (§6.6 alt="" equivalent)');
  assert("categories-2col-1440",
    typeof struct.gridCols === "string" && struct.gridCols.split(" ").length === 2,
    `grid-template-columns=${struct.gridCols}`);

  // ── responsive 375 ──
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
  });
  await cdpSend(ws, "Page.navigate", { url: URL_STACK });
  await sleep(2500);
  const mob = await cdpEval(ws, `(() => {
    const doc = document.documentElement;
    const h1 = document.querySelector("h1");
    const r = h1?.getBoundingClientRect();
    const grid = document.querySelector('[data-testid="stack-grid"]');
    const overflowing = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.right > 376 && rect.width > 0;
    }).slice(0, 5).map((el) => el.className || el.tagName);
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      h1Visible: !!r && r.width > 0 && r.height > 0,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      overflowing,
    };
  })()`);
  computed.mobile375 = mob;
  assert("no-horizontal-overflow-375", mob.scrollWidth <= 375,
    `scrollWidth=${mob.scrollWidth}`);
  assert("h1-visible-375", mob.h1Visible, `h1Visible=${mob.h1Visible}`);
  assert("grid-single-col-375",
    typeof mob.gridCols === "string" && mob.gridCols.split(" ").length === 1,
    `grid-template-columns=${mob.gridCols}`);
  assert("no-overflowing-elements-375", mob.overflowing.length === 0,
    `offenders=${JSON.stringify(mob.overflowing)}`);

  // ── artifacts ──
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await cdpSend(ws, "Page.navigate", { url: URL_STACK });
  await sleep(2500);
  console.log("\n[probe] === ARTIFACTS ===");
  const shot = await cdpSend(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync(join(EVIDENCE_DIR, "task-10-screenshot-1440.png"), Buffer.from(shot.data, "base64"));
  const domHtml = await cdpEval(ws, "document.documentElement.outerHTML");
  writeFileSync(join(EVIDENCE_DIR, "task-10-dom-dump.html"), domHtml, "utf8");
  computed.finishedAt = new Date().toISOString();
  writeFileSync(join(EVIDENCE_DIR, "task-10-computed-styles.json"), JSON.stringify(computed, null, 2), "utf8");
  console.log("[probe] wrote task-10-screenshot-1440.png, task-10-dom-dump.html, task-10-computed-styles.json");

  ws.close();
} catch (err) {
  console.error("[probe] FATAL:", err);
  failures++;
} finally {
  await cleanup();
}

console.log("\n" + JSON.stringify({
  timestamp: new Date().toISOString(),
  failures,
  pass: failures === 0,
  results,
}, null, 2));

if (failures > 0) {
  console.log(`\n[probe] FAIL — ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\n[probe] PASS — all assertions passed`);
  process.exit(0);
}
