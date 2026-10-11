#!/usr/bin/env node
/**
 * verify-case-study.mjs — zero-dependency CDP probe for task 8: the case study
 * template (§6.4) at /work/[slug].
 *
 * Asserts: the 11-section content contract in order; optional sections
 * (Constraints, Reflection) safe when empty; gallery aspect-ratio locked;
 * stack + links sections present; §6.4 publish rule — unknown slug or a
 * project with no Outcome → notFound() → HTTP 404.
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
const BASE = "http://127.0.0.1:" + PORT;
const ARGV = process.argv.slice(2);
const SKIP_BUILD = ARGV.includes("--skip-build");
const argValue = (flag, fallback) => {
  const i = ARGV.indexOf(flag);
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : fallback;
};
const OUT_DIR = argValue("--out-dir", join(ROOT, "..", ".omo", "evidence"));

const FULL = ["overview", "problem", "constraints", "role", "decision", "solution", "outcome", "reflection", "gallery", "stack", "links"];
const OPTIONAL_SKIPPED = ["overview", "problem", "role", "decision", "solution", "outcome", "gallery", "stack", "links"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
let chromeProc = null;
let chromeTmpDir = null;
let failures = 0;
const results = {};

function assert(name, condition, details) {
  if (condition) {
    results[name] = { pass: true, details };
    console.log("  OK   " + name);
  } else {
    results[name] = { pass: false, details };
    console.log("  FAIL " + name + ": " + details);
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
    console.log("[probe] pre-free " + label + " port " + port + " (pid " + pid + ")");
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
    const timeout = setTimeout(() => reject(new Error("CDP timeout: " + method)), 15000);
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
    const res = await fetch(BASE + path, { redirect: "manual" });
    return res.status;
  } catch {
    return null;
  }
}

const READ_SECTIONS = `(() => {
  const article = document.querySelector('article.case-study') || document.querySelector('article');
  const sections = [...document.querySelectorAll('[data-case-section]')];
  const fig = document.querySelector('.case-gallery__figure');
  const h1 = document.querySelector('h1');
  return {
    hasArticle: !!article,
    h1Count: document.querySelectorAll('h1').length,
    h1: h1 ? h1.textContent.trim() : null,
    order: sections.map((s) => s.getAttribute('data-case-section')),
    headings: sections.map((s) => {
      const h = s.querySelector('h2, h3');
      return h ? h.textContent.trim() : null;
    }),
    galleryAspect: fig ? getComputedStyle(fig).aspectRatio : null,
    stackCount: document.querySelectorAll('.case-stack__item').length,
    linkCount: document.querySelectorAll('.case-links__item').length,
    wordCount: article ? article.textContent.trim().split(/\\s+/).length : 0,
    backHref: document.querySelector('.case-back') ? document.querySelector('.case-back').getAttribute('href') : null,
  };
})()`;

async function runCaseSuite(ws, computed) {
  console.log("\n[probe] === CASE STUDY FULL (/work/buku-tahu) ===");
  await navigate(ws, BASE + "/work/buku-tahu", 1800);
  const full = await cdpEval(ws, READ_SECTIONS);
  computed.full = full;
  assert("case-article-present", full.hasArticle, JSON.stringify({ hasArticle: full.hasArticle }));
  assert(
    "case-single-h1",
    full.h1Count === 1 && full.h1 === "Buku Tahu",
    JSON.stringify({ h1Count: full.h1Count, h1: full.h1 })
  );
  assert("case-11-sections-in-order", full.order.join(",") === FULL.join(","), JSON.stringify({ got: full.order }));
  assert(
    "case-section-headings",
    full.headings.join("|") ===
      "Overview|Problem|Constraints|Role|Key Decision|Solution|Outcome|Reflection|Gallery|Stack|Links",
    JSON.stringify(full.headings)
  );
  assert(
    "case-gallery-aspect-locked",
    ["16 / 10", "16/10", "1.6"].includes(String(full.galleryAspect)),
    "aspect-ratio=" + full.galleryAspect
  );
  assert("case-stack-items", full.stackCount >= 1, "stack items=" + full.stackCount);
  assert("case-links-present", full.linkCount >= 1, "link items=" + full.linkCount);
  assert("case-back-link", full.backHref === "/work", "back href=" + full.backHref);

  console.log("\n[probe] === OPTIONAL SECTIONS SKIPPED (/work/apecx-2026) ===");
  await navigate(ws, BASE + "/work/apecx-2026", 1800);
  const optional = await cdpEval(ws, READ_SECTIONS);
  computed.optionalSkipped = optional;
  assert(
    "case3-optional-safe-order",
    optional.order.join(",") === OPTIONAL_SKIPPED.join(","),
    JSON.stringify({ got: optional.order })
  );
  assert(
    "case3-constraints-reflection-absent",
    !optional.order.includes("constraints") && !optional.order.includes("reflection"),
    JSON.stringify(optional.order)
  );
  assert("case3-outcome-present", optional.order.includes("outcome"), JSON.stringify(optional.order));
}

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
    console.log("[probe] Build done in " + (Date.now() - t0) + "ms");
  }

  console.log("[probe] Starting server on " + PORT);
  const logFd = openSync(join(OUT_DIR, "task-8-server.log"), "w");
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
      await fetch(BASE + "/work/buku-tahu", { redirect: "manual" });
      ready = true;
      break;
    } catch {}
  }
  if (!ready) {
    results.server = { pass: false, details: "no HTTP response within 60s" };
    failures++;
    return;
  }
  console.log("[probe] Server ready (pid " + serverProc.pid + ")");

  console.log("\n[probe] === HTTP STATUS (§6.4 publish rule) ===");
  const caseStatus = await httpStatus("/work/buku-tahu");
  assert("http-case-200", caseStatus === 200, "/work/buku-tahu -> " + caseStatus);
  const unknownStatus = await httpStatus("/work/does-not-exist");
  assert("http-unknown-slug-404", unknownStatus === 404, "/work/does-not-exist -> " + unknownStatus);
  const noOutcomeStatus = await httpStatus("/case-qa/no-outcome");
  assert("http-no-outcome-404", noOutcomeStatus === 404, "/case-qa/no-outcome -> " + noOutcomeStatus);

  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-case-probe-"));
  chromeProc = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=" + CDP_PORT,
      "--user-data-dir=" + chromeTmpDir,
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
      const targets = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/list")).json();
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
  console.log("[probe] CDP connected (pid " + chromeProc.pid + ")");

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
    contract: { full: FULL, optionalSkipped: OPTIONAL_SKIPPED },
    note: "wordCount is informational; 400-700 word budget applies to filled copy, not literal slots",
  };

  await runCaseSuite(ws, computed);

  console.log("\n[probe] === ARTIFACTS ===");
  await navigate(ws, BASE + "/work/buku-tahu", 1800);
  const shot = await cdpSend(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT_DIR, "task-8-screenshot-1440.png"), Buffer.from(shot.data, "base64"));
  const html = await cdpEval(ws, "document.documentElement.outerHTML");
  writeFileSync(join(OUT_DIR, "task-8-dom-dump.html"), html, "utf8");
  writeFileSync(join(OUT_DIR, "task-8-computed-styles.json"), JSON.stringify(computed, null, 2), "utf8");
  console.log("[probe] wrote task-8-screenshot-1440.png, task-8-dom-dump.html, task-8-computed-styles.json");

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
    "[probe] cleanup: port " + PORT + " free=" + (portPids(PORT).length === 0) +
      ", port " + CDP_PORT + " free=" + (portPids(CDP_PORT).length === 0)
  );
}

const output = { timestamp: new Date().toISOString(), failures, pass: failures === 0, results };
console.log("\n" + JSON.stringify(output, null, 2));
process.exit(failures > 0 ? 1 : 0);
