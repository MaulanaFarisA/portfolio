#!/usr/bin/env node
/**
 * verify-404.mjs — Zero-dependency CDP probe for §6.12 404 page.
 * Node 22 global WebSocket + fetch + chrome --headless=new.
 * HARDENED: detached server, stdio to file, tree-kill, port-free polling.
 * Exits 0 on all-pass, 1 on any mismatch.
 */
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, openSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3108;
const CDP_PORT = 9231;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const NOT_FOUND_URL = `http://localhost:${PORT}/halaman-ngawur`;
const ROOT = join(import.meta.dirname, "..");
const EVIDENCE_DIR = join(ROOT, "..", ".omo", "evidence");

// Ensure evidence dir
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
const serverLogFd = openSync(join(EVIDENCE_DIR, "task-12-server.log"), "w");

// ── helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── processes to clean up ──
let serverProc = null;
let chromeProc = null;
let chromeTmpDir = null;

function killTree(pid) {
  if (!pid) return;
  try { execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: "ignore" }); } catch {}
}

async function waitPortFree(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      await sleep(500);
    } catch {
      console.log(`[cleanup] port ${port} free`);
      return true;
    }
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
  console.log("[cleanup] server tree dead: true");
  try {
    if (chromeTmpDir) rmSync(chromeTmpDir, { recursive: true, force: true });
  } catch {}
}

process.on("exit", () => {
  killTree(chromeProc?.pid);
  killTree(serverProc?.pid);
});
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

try {
  // ── 1. Build & start prod server (DETACHED, stdio to file) ──
  if (process.argv.includes("--skip-build")) {
    console.log("[probe] Skipping build (--skip-build)");
  } else {
    console.log("[probe] Building...");
    const buildStart = Date.now();
    execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
    console.log(`[probe] Build done in ${Date.now() - buildStart}ms`);
  }

  console.log("[probe] Starting DETACHED server on port", PORT);
  serverProc = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    {
      cwd: ROOT,
      stdio: ["ignore", serverLogFd, serverLogFd],
      detached: true,
    }
  );
  serverProc.unref();

  // Wait for server ready
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) break;
    } catch {}
    if (i === 29) { console.error("[probe] Server did not start"); await cleanup(); process.exit(1); }
  }
  console.log("[probe] Server ready");

  // ═══════════════════════════════════════
  // TEST 0: HTTP status 404 via fetch
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 0: HTTP 404 status code");
  const httpRes = await fetch(NOT_FOUND_URL);
  assert("http-status-404", httpRes.status === 404, `status=${httpRes.status}`);

  // ── 2. Launch Chrome headless (DETACHED, stdio ignore) ──
  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-404-probe-"));
  chromeProc = spawn(CHROME, [
    `--headless=new`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeTmpDir}`,
    `--disable-gpu`,
    `--no-sandbox`,
    `--window-size=1280,900`,
  ], { stdio: "ignore", detached: true });
  chromeProc.unref();

  await sleep(2000);

  // Get page-level WS endpoint
  let wsUrl;
  for (let i = 0; i < 15; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await resp.json();
      const page = targets.find(t => t.type === "page");
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(500);
  }
  if (!wsUrl) { console.error("[probe] Chrome CDP not reachable"); await cleanup(); process.exit(1); }
  console.log("[probe] CDP connected:", wsUrl);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  await cdpSend(ws, "Page.enable");
  await cdpSend(ws, "Runtime.enable");

  // Navigate to nonexistent page
  await cdpSend(ws, "Page.navigate", { url: NOT_FOUND_URL });
  await sleep(3000);

  // ═══════════════════════════════════════
  // TEST 1: meta robots noindex present
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 1: meta robots noindex");
  const metaRobots = await cdpEval(ws, `
    (() => {
      const meta = document.querySelector('meta[name="robots"]');
      return {
        exists: !!meta,
        content: meta?.getAttribute('content'),
      };
    })()
  `);
  assert("meta-robots-exists", metaRobots.exists, JSON.stringify(metaRobots));
  assert("meta-robots-noindex",
    metaRobots.content && metaRobots.content.includes("noindex"),
    `content="${metaRobots.content}"`
  );

  // ═══════════════════════════════════════
  // TEST 2: Pixel art scene present
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 2: Pixel art scene");
  const pixelScene = await cdpEval(ws, `
    (() => {
      const svgs = document.querySelectorAll('svg');
      const pixelEls = document.querySelectorAll('[class*="pixel"], [class*="404"]');
      return {
        svgCount: svgs.length,
        pixelElCount: pixelEls.length,
        hasScene: svgs.length > 0 || pixelEls.length > 0,
      };
    })()
  `);
  assert("pixel-scene-exists", pixelScene.hasScene, JSON.stringify(pixelScene));

  // ═══════════════════════════════════════
  // TEST 3: Short message text
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 3: 404 message text");
  const messageText = await cdpEval(ws, `
    (() => {
      const main = document.querySelector('main') || document.body;
      const text = main.textContent.trim();
      return {
        hasText: text.length > 10,
        sample: text.substring(0, 200),
        mentions404: text.includes('404') || text.toLowerCase().includes('not found') || text.toLowerCase().includes('tidak ditemukan'),
      };
    })()
  `);
  assert("404-message-present", messageText.hasText, `text="${messageText.sample}"`);
  assert("404-mentions-not-found", messageText.mentions404, `text="${messageText.sample}"`);

  // ═══════════════════════════════════════
  // TEST 4: Link to home page
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 4: Home link");
  const homeLink = await cdpEval(ws, `
    (() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const homeLink = links.find(a =>
        a.href === '${`http://localhost:${PORT}/`}' ||
        a.getAttribute('href') === '/' ||
        a.textContent.toLowerCase().includes('home') ||
        a.textContent.toLowerCase().includes('kembali') ||
        a.textContent.toLowerCase().includes('beranda')
      );
      return {
        exists: !!homeLink,
        href: homeLink?.getAttribute('href'),
        text: homeLink?.textContent?.trim(),
      };
    })()
  `);
  assert("home-link-exists", homeLink.exists, JSON.stringify(homeLink));
  assert("home-link-points-home",
    homeLink.href === "/" || homeLink.href === `http://localhost:${PORT}/`,
    `href="${homeLink.href}"`
  );

  // ═══════════════════════════════════════
  // TEST 5: Page is responsive (375px)
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 5: Responsive at 375px");
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
  });
  await cdpSend(ws, "Page.navigate", { url: NOT_FOUND_URL });
  await sleep(3000);

  const mobileCheck = await cdpEval(ws, `
    (() => {
      const body = document.body;
      const overflows = body.scrollWidth > 375;
      const main = document.querySelector('main') || body;
      const rect = main.getBoundingClientRect();
      return {
        overflows,
        bodyScrollWidth: body.scrollWidth,
        mainWidth: Math.round(rect.width),
      };
    })()
  `);
  assert("no-horizontal-overflow-mobile", !mobileCheck.overflows,
    `scrollWidth=${mobileCheck.bodyScrollWidth}`);

  // ═══════════════════════════════════════
  // TEST 6: Single h1 on 404 page
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 6: Single h1");
  const h1Count = await cdpEval(ws, `document.querySelectorAll('h1').length`);
  assert("single-h1", h1Count === 1, `h1 count=${h1Count}`);

  // ═══════════════════════════════════════
  // TEST 7: not-found.tsx source exists
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 7: not-found.tsx source exists");
  assert("not-found-tsx-exists",
    existsSync(join(ROOT, "src", "app", "not-found.tsx")),
    "src/app/not-found.tsx"
  );

  // ── Report ──
  console.log("\n" + JSON.stringify({
    timestamp: new Date().toISOString(),
    failures,
    pass: failures === 0,
    results,
  }, null, 2));

  ws.close();
} catch (err) {
  console.error("[probe] FATAL:", err);
  failures++;
} finally {
  await cleanup();
}

if (failures > 0) {
  console.log(`\n[probe] FAIL — ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\n[probe] PASS — all assertions passed`);
  process.exit(0);
}
