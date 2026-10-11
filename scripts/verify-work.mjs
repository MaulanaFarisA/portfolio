#!/usr/bin/env node
/**
 * verify-work.mjs — zero-dependency CDP probe for task 7: Work index (§5.4).
 *
 * Asserts: /work renders the project grid with featured-first ordering and the
 * §5.4 count rules — 0 → empty state (EMPTY_WORK_MESSAGE), 1–2 → full-width,
 * 3 → 2x2 with the odd last card spanning the row (no stretched orphan),
 * 4 → 2x2 with no orphan span (even count), 5+ → featured row + remainder list
 * — via temp /work-qa/[count] fixtures.
 *
 * Lifecycle: pre-frees ports 3107/9230, spawns `next start` + Chrome DETACHED
 * (stdio to file/ignore), kills both trees with taskkill /T /F (finally + exit
 * hooks), polls the ports dead. Watchdog: 10 minutes.
 * Exits 0 on all-pass, 1 on any assertion or build failure.
 */
import { execSync, execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PORT = 3107;
const CDP_PORT = 9230;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const BASE = `http://127.0.0.1:${PORT}`;
const ARGV = process.argv.slice(2);
const SKIP_BUILD = ARGV.includes("--skip-build");
const argValue = (flag, fallback) => {
  const i = ARGV.indexOf(flag);
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : fallback;
};
const OUT_DIR = argValue("--out-dir", join(ROOT, "..", ".omo", "evidence"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
let chromeProc = null;
let chromeTmpDir = null;
let failures = 0;
const results = {};

function assert(name, condition, details) {
  if (condition) {
    results[name] = { pass: true, details };
    console.log(`  OK   ${name}`);
  } else {
    results[name] = { pass: false, details };
    console.log(`  FAIL ${name}: ${details}`);
    failures++;
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
}

function portPids(port) {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (m && Number(m[1]) === port) pids.add(Number(m[2]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

async function waitPortFree(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (portPids(port).length === 0) return true;
    await sleep(500);
  }
  return portPids(port).length === 0;
}

function freePortSync(port, label) {
  for (const pid of portPids(port)) {
    console.log(`[probe] pre-free ${label} port ${port} (pid ${pid})`);
    killTree(pid);
  }
}

function cleanupSync() {
  killTree(chromeProc?.pid);
  killTree(serverProc?.pid);
}

process.on("exit", () => {
  cleanupSync();
  if (chromeTmpDir) {
    try {
      rmSync(chromeTmpDir, { recursive: true, force: true });
    } catch {}
  }
});
process.on("SIGINT", () => {
  cleanupSync();
  process.exit(1);
});
process.on("SIGTERM", () => {
  cleanupSync();
  process.exit(1);
});

const watchdog = setTimeout(() => {
  console.error("[probe] WATCHDOG TIMEOUT after 10 minutes");
  process.exit(2);
}, 10 * 60 * 1000);
watchdog.unref();

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
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

async function navigate(ws, url, settleMs = 1500) {
  await cdpSend(ws, "Page.navigate", { url });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    await sleep(250);
    try {
      if ((await cdpEval(ws, "document.readyState")) === "complete") break;
    } catch {}
  }
  await sleep(settleMs);
}

async function httpStatus(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    return res.status;
  } catch {
    return null;
  }
}

const READ_FIXTURE = `(() => {
  const root = document.querySelector('[data-qa-fixture]');
  const grid = document.querySelector('[data-testid="project-grid"], .project-grid');
  const cards = [...document.querySelectorAll('[data-testid="project-card"], .project-card')];
  const empty = document.querySelector('[data-testid="empty-work"], .empty-work-card');
  const list = document.querySelector('.project-list');
  const lead = document.querySelector('[data-featured="true"], .project-card--featured');
  return {
    fixtureAttr: root ? root.getAttribute('data-qa-fixture') : null,
    cardCount: cards.length,
    gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
    emptyState: !!empty,
    emptyText: empty ? empty.textContent.trim() : null,
    listCount: list ? list.querySelectorAll('.project-card').length : 0,
    featuredCount: document.querySelectorAll('[data-featured="true"], .project-card--featured').length,
    leadRatio: lead && grid ? lead.getBoundingClientRect().width / grid.getBoundingClientRect().width : null,
    lastGridColumn: cards.length ? getComputedStyle(cards[cards.length - 1]).gridColumn : null,
  };
})()`;

async function main() {
  freePortSync(PORT, "server");
  freePortSync(CDP_PORT, "cdp");
  await waitPortFree(PORT, 5000);
  await waitPortFree(CDP_PORT, 5000);
  mkdirSync(OUT_DIR, { recursive: true });

  if (SKIP_BUILD) {
    console.log("[probe] --skip-build: reusing existing .next");
  } else {
    console.log("[probe] Building...");
    const t0 = Date.now();
    execSync("npm run build", { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
    console.log(`[probe] Build done in ${Date.now() - t0}ms`);
  }

  console.log(`[probe] Starting server on ${PORT}`);
  const logFd = openSync(join(OUT_DIR, "task-7-server.log"), "w");
  serverProc = spawn(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  closeSync(logFd);

  let ready = false;
  const srvT0 = Date.now();
  while (Date.now() - srvT0 < 60000) {
    await sleep(700);
    try {
      await fetch(`${BASE}/work`, { redirect: "manual" });
      ready = true;
      break;
    } catch {}
  }
  if (!ready) {
    results.server = { pass: false, details: "no HTTP response on /work within 60s" };
    failures++;
    return;
  }
  console.log(`[probe] Server ready (pid ${serverProc.pid})`);

  console.log("\n[probe] === HTTP STATUS ===");
  const workStatus = await httpStatus("/work");
  assert("http-work-200", workStatus === 200, `/work -> ${workStatus}`);
  for (const n of [0, 1, 3, 5]) {
    const st = await httpStatus(`/work-qa/${n}`);
    assert(`http-work-qa-${n}-200`, st === 200, `/work-qa/${n} -> ${st}`);
  }

  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-work-probe-"));
  chromeProc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeTmpDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--window-size=1440,900",
    ],
    { detached: true, stdio: "ignore", windowsHide: true }
  );

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }
  if (!wsUrl) {
    results.chrome = { pass: false, details: "no CDP page target" };
    failures++;
    return;
  }
  console.log(`[probe] CDP connected (pid ${chromeProc.pid})`);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  await cdpSend(ws, "Page.enable");
  await cdpSend(ws, "Runtime.enable");
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdpSend(ws, "Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: "dark" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ],
  });

  const computed = {
    capturedAt: new Date().toISOString(),
    buildId: readFileSync(join(ROOT, ".next", "BUILD_ID"), "utf8").trim(),
    viewport: "1440x900",
  };

  console.log("\n[probe] === /work INDEX ===");
  await navigate(ws, `${BASE}/work`, 1800);
  const work = await cdpEval(
    ws,
    `(() => {
      const h1 = document.querySelector('h1');
      const grid = document.querySelector('[data-testid="project-grid"], .project-grid');
      const cards = [...document.querySelectorAll('[data-testid="project-card"], .project-card')];
      return {
        h1: h1 ? h1.textContent.trim() : null,
        gridClass: grid ? grid.className : null,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
        cardCount: cards.length,
        hrefs: cards.map((c) => c.getAttribute('href')),
        lastClass: cards.length ? cards[cards.length - 1].className : null,
        lastGridColumn: cards.length ? getComputedStyle(cards[cards.length - 1]).gridColumn : null,
      };
    })()`
  );
  computed.work = work;
  assert("work-h1", work.h1 === "Work", `h1=${work.h1}`);
  assert("work-four-cards", work.cardCount === 4, `count=${work.cardCount}`);
  assert(
    "work-featured-first",
    work.hrefs[0] === "/work/apecx-2026" && work.hrefs[1] === "/work/malpres-2025" && work.hrefs[2] === "/work/buku-tahu" && work.hrefs[3] === "/work/astar",
    JSON.stringify(work.hrefs)
  );
  assert(
    "work-quad-two-columns",
    /project-grid--quad/.test(String(work.gridClass)) && String(work.gridColumns).split(" ").length === 2,
    JSON.stringify({ cls: work.gridClass, cols: work.gridColumns })
  );
  assert(
    "work-orphan-spans-row",
    !/project-card--span/.test(String(work.lastClass)) && !String(work.lastGridColumn).includes("-1"),
    JSON.stringify({ lastClass: work.lastClass, gridColumn: work.lastGridColumn })
  );

  console.log("\n[probe] === §5.4 GRID COUNTS (fixtures) ===");
  computed.fixtures = {};
  for (const n of [0, 1, 3, 5]) {
    await navigate(ws, `${BASE}/work-qa/${n}`, 1200);
    const info = await cdpEval(ws, READ_FIXTURE);
    computed.fixtures[String(n)] = info;
    assert(`work-qa-${n}-fixture`, info.fixtureAttr === String(n), JSON.stringify(info));
    if (n === 0) {
      assert(
        "work-qa-0-empty-state",
        info.emptyState && String(info.emptyText).includes("No published work yet. New projects land here soon."),
        JSON.stringify(info)
      );
    } else if (n === 1) {
      assert(
        "work-qa-1-full-width",
        info.cardCount === 1 && info.leadRatio !== null && info.leadRatio > 0.9,
        JSON.stringify(info)
      );
    } else if (n === 3) {
      assert("work-qa-3-count", info.cardCount === 3, JSON.stringify(info));
      assert(
        "work-qa-3-orphan-spans",
        String(info.lastGridColumn).includes("-1"),
        `gridColumn=${info.lastGridColumn}`
      );
    } else {
      assert("work-qa-5-count", info.cardCount === 5, JSON.stringify(info));
      assert(
        "work-qa-5-featured-row-plus-list",
        info.featuredCount === 1 && info.listCount === 4,
        JSON.stringify(info)
      );
    }
  }

  console.log("\n[probe] === ARTIFACTS ===");
  await navigate(ws, `${BASE}/work`, 1800);
  const shot = await cdpSend(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT_DIR, "task-7-screenshot-1440.png"), Buffer.from(shot.data, "base64"));
  const html = await cdpEval(ws, "document.documentElement.outerHTML");
  writeFileSync(join(OUT_DIR, "task-7-dom-dump.html"), html, "utf8");
  writeFileSync(join(OUT_DIR, "task-7-computed-styles.json"), JSON.stringify(computed, null, 2), "utf8");
  console.log("[probe] wrote task-7-screenshot-1440.png, task-7-dom-dump.html, task-7-computed-styles.json");

  ws.close();
}

try {
  await main();
} catch (err) {
  console.error("[probe] error:", err.message);
  results.uncaught = { pass: false, details: err.message };
  failures++;
} finally {
  cleanupSync();
  await waitPortFree(PORT, 15000);
  await waitPortFree(CDP_PORT, 10000);
  console.log(
    `[probe] cleanup: port ${PORT} free=${portPids(PORT).length === 0}, port ${CDP_PORT} free=${portPids(CDP_PORT).length === 0}`
  );
}

const output = { timestamp: new Date().toISOString(), failures, pass: failures === 0, results };
console.log("\n" + JSON.stringify(output, null, 2));
process.exit(failures > 0 ? 1 : 0);
