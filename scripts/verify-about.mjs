#!/usr/bin/env node
/**
 * verify-about.mjs — Zero-dependency CDP probe for the About page (§6.5).
 *
 * Node 22 global WebSocket + fetch + Chrome headless. Ports: server 3109,
 * CDP 9232 (task-9/10 worker allocation). Build runs under the shared
 * build.lock; the server is spawned detached with stdio to a file and the
 * whole tree is killed on every exit path.
 *
 * Usage: node scripts/verify-about.mjs [--skip-build]
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
const URL_ABOUT = `http://localhost:${PORT}/about`;
const SKIP_BUILD = process.argv.includes("--skip-build");

if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
const serverLogFd = openSync(join(EVIDENCE_DIR, "task-9-server.log"), "w");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const syncSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ── build lock ──
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

// ── CDP helpers ──
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

// ── lifecycle ──
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

const computed = { probe: "verify-about", startedAt: new Date().toISOString() };

try {
  // ── 0. port pre-free ──
  try {
    await fetch(`http://127.0.0.1:${PORT}/`);
    console.warn(`[probe] port ${PORT} occupied before start — aborting to avoid orphan conflicts`);
    process.exit(1);
  } catch { console.log(`[probe] port ${PORT} free`); }

  // ── 1. build under lock ──
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

  // ── 2. detached server ──
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

  // ── 3. HTTP status ──
  const httpRes = await fetch(URL_ABOUT);
  assert("http-about-200", httpRes.status === 200, `status=${httpRes.status}`);
  const html = await httpRes.text();
  assert("ssr-h1-in-payload", html.includes(">About<"), "server HTML contains h1 text");
  assert("ssr-avatar-img-in-payload", html.includes("avatar.jpg"), "avatar.jpg img src in SSR payload");

  // ── 4. Chrome ──
  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-about-probe-"));
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
  await cdpSend(ws, "Page.navigate", { url: URL_ABOUT });
  await sleep(3000);

  // ── 5. structure assertions ──
  const struct = await cdpEval(ws, `(() => {
    const h1s = Array.from(document.querySelectorAll("h1"));
    const avatar = document.querySelector('[data-testid="about-avatar"]');
    const bio = document.querySelector('[data-testid="about-bio"]');
    const grid = document.querySelector('[data-testid="about-skill-grid"]');
    const tl = document.querySelector('[data-testid="about-timeline"]');
    const main = document.querySelector("main");
    return {
      h1Count: h1s.length,
      h1Text: h1s[0]?.textContent?.trim() ?? null,
      title: document.title,
      avatarTag: avatar?.tagName ?? null,
      avatarRole: avatar?.getAttribute("role") ?? null,
      avatarLabel: avatar?.getAttribute("aria-label") ?? null,
      avatarText: avatar?.textContent ?? null,
      avatarImgSrc: avatar?.querySelector("img")?.getAttribute("src") ?? null,
      avatarImgAlt: avatar?.querySelector("img")?.getAttribute("alt") ?? null,
      avatarHasDither: !!avatar?.classList.contains("dither-surface"),
      avatarAspect: avatar ? getComputedStyle(avatar).aspectRatio : null,
      bioText: bio?.textContent ?? null,
      gridTag: grid?.tagName ?? null,
      gridItems: grid ? grid.querySelectorAll("li").length : 0,
      gridInteractive: grid ? grid.querySelectorAll("a, button, [tabindex]").length : -1,
      timelineTag: tl?.tagName ?? null,
      timelineItems: tl ? tl.querySelectorAll(":scope > li").length : 0,
      timelineYear: tl?.querySelector(".about-timeline__year")?.textContent ?? null,
      mainText: main?.textContent ?? "",
    };
  })()`);
  computed.structure = struct;

  assert("single-h1", struct.h1Count === 1, `count=${struct.h1Count}`);
  assert("h1-text-about", struct.h1Text === "About", `text="${struct.h1Text}"`);
  assert("title-template", struct.title === "About - Maulana Faris", `title="${struct.title}"`);
  assert("avatar-img-src",
    (struct.avatarImgSrc ?? "").includes("avatar.jpg"),
    `src="${struct.avatarImgSrc}"`);
  assert("avatar-img-alt",
    typeof struct.avatarImgAlt === "string" && struct.avatarImgAlt.trim().length > 3,
    `alt="${struct.avatarImgAlt}"`);
  assert("avatar-dither-surface", struct.avatarHasDither, `class present=${struct.avatarHasDither}`);
  assert("avatar-aspect-locked", struct.avatarAspect === "1 / 1", `aspect=${struct.avatarAspect}`);
  assert("bio-final-text",
    (struct.bioText ?? "").trim() === "I'm a Computer Science student at Universitas Gadjah Mada, Yogyakarta, building web products end-to-end and learning how to break them, too. I'm a Bakti BCA 2026 scholarship awardee, selected from 700 students across 20 universities. Over the past two years I've shipped production platforms: Buku Tahu, a bookkeeping app for tofu SMEs, and the Jemparingan QR scoring system, both live. I built core sections of the APECX 2026 platform and co-authored two cybersecurity training modules for IndoCEISS. As team lead at Dinas Pariwisata Kulon Progo, I'm leading a 6-person team rebuilding the regency's tourism platform. Beyond code, I lead Event Activation at OmahTI UGM, running 13 programs in one term, coordinating across HR, PR, design, and all 8 technical divisions. My goal is to grow into an engineer who builds products that are user-centered and secure by design. Currently open to internships in software engineering, web development, and cybersecurity.",
    `text="${(struct.bioText ?? "").slice(0, 40)}"`);
  assert("skill-grid-is-ul", struct.gridTag === "UL", `tag=${struct.gridTag}`);
  assert("skill-grid-8-items", struct.gridItems === 8, `items=${struct.gridItems}`);
  assert("skill-chips-non-interactive", struct.gridInteractive === 0,
    `interactive children=${struct.gridInteractive}`);
  assert("timeline-is-ol", struct.timelineTag === "OL", `tag=${struct.timelineTag}`);
  assert("timeline-4-items", struct.timelineItems === 4, `items=${struct.timelineItems}`);
  assert("timeline-year-final", struct.timelineYear === "2024",
    `year="${struct.timelineYear}"`);
  assert("all-skill-final",
    ["Web Development","TypeScript","React","Next.js","Tailwind CSS","Supabase","Cybersecurity","Git"]
      .every((name) => struct.mainText.includes(name)),
    "8 final skill names present in DOM text");

  // ── 6. responsive 375 ──
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
  });
  await cdpSend(ws, "Page.navigate", { url: URL_ABOUT });
  await sleep(2500);
  const mob = await cdpEval(ws, `(() => {
    const doc = document.documentElement;
    const h1 = document.querySelector("h1");
    const r = h1?.getBoundingClientRect();
    const overflowing = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.right > 376 && rect.width > 0;
    }).slice(0, 5).map((el) => el.className || el.tagName);
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      h1Visible: !!r && r.width > 0 && r.height > 0,
      overflowing,
    };
  })()`);
  computed.mobile375 = mob;
  assert("no-horizontal-overflow-375", mob.scrollWidth <= 375,
    `scrollWidth=${mob.scrollWidth}`);
  assert("h1-visible-375", mob.h1Visible, `h1Visible=${mob.h1Visible}`);
  assert("no-overflowing-elements-375", mob.overflowing.length === 0,
    `offenders=${JSON.stringify(mob.overflowing)}`);

  // ── 7. artifacts (1440 viewport) ──
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await cdpSend(ws, "Page.navigate", { url: URL_ABOUT });
  await sleep(2500);
  console.log("\n[probe] === ARTIFACTS ===");
  const shot = await cdpSend(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync(join(EVIDENCE_DIR, "task-9-screenshot-1440.png"), Buffer.from(shot.data, "base64"));
  const domHtml = await cdpEval(ws, "document.documentElement.outerHTML");
  writeFileSync(join(EVIDENCE_DIR, "task-9-dom-dump.html"), domHtml, "utf8");
  computed.finishedAt = new Date().toISOString();
  writeFileSync(join(EVIDENCE_DIR, "task-9-computed-styles.json"), JSON.stringify(computed, null, 2), "utf8");
  console.log("[probe] wrote task-9-screenshot-1440.png, task-9-dom-dump.html, task-9-computed-styles.json");

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
