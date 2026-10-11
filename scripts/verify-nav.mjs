#!/usr/bin/env node
/**
 * verify-nav.mjs — zero-dependency CDP probe for design.md section 6.1 SiteNav.
 *
 * Lifecycle hardening: `next start` and Chrome are spawned DETACHED with stdio
 * ignored, so no child ever holds this process's stdout pipe. Both trees are
 * killed with `taskkill /PID <pid> /T /F` (finally + process exit hook) and the
 * ports are polled free afterwards, so an orphaned server can never hang the
 * shell that launched this script.
 *
 * Exits 0 on all-pass, 1 on any assertion or build failure.
 */
import { execFileSync, execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PORT = 3106;
const CDP_PORT = 9227;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const PAGE_URL = `http://127.0.0.1:${PORT}/nav-qa`;

const AMBER = "rgb(245, 158, 11)";
const PANEL_BG = "rgb(20, 22, 24)";
const BORDER_BG = "rgb(40, 44, 50)";
const INK_ON_AMBER = "rgb(26, 25, 24)";
const LIGHT_CANVAS = "rgb(247, 246, 242)"; // #F7F6F2 light --surface-canvas
const DARK_CANVAS = "rgb(12, 13, 14)"; // #0C0D0E dark --surface-canvas

const ARGV = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = ARGV.indexOf(flag);
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : fallback;
}
const MODE = ARGV.includes("--artifacts")
  ? "artifacts"
  : ARGV.includes("--httpcheck")
    ? "httpcheck"
    : "probe";
const OUT_DIR = argValue("--out-dir", join(ROOT, "..", ".omo", "evidence"));
const SKIP_BUILD = ARGV.includes("--skip-build");
const HTTP_PATH = argValue("--path", "/");
const HTTP_EXPECT = Number(argValue("--expect", "200"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
let chromeProc = null;
let chromeTmpDir = null;

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
  const pids = portPids(port);
  for (const pid of pids) {
    console.log(`[probe] freeing ${label} port ${port} (pid ${pid})`);
    killTree(pid);
  }
  return pids.length;
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

async function safeSend(ws, method, params) {
  try {
    await cdpSend(ws, method, params);
    return true;
  } catch {
    return false;
  }
}

async function setMedia(ws, scheme, motion = "no-preference") {
  await cdpSend(ws, "Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: scheme },
      { name: "prefers-reduced-motion", value: motion },
    ],
  });
}

async function pressKey(ws, key, vk, code, text) {
  await cdpSend(ws, "Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    ...(text ? { text, unmodifiedText: text } : {}),
  });
  await cdpSend(ws, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  await sleep(140);
}

const tab = (ws) => pressKey(ws, "Tab", 9, "Tab");
const enter = (ws) => pressKey(ws, "Enter", 13, "Enter", "\r");
const space = (ws) => pressKey(ws, " ", 32, "Space");
const escapeKey = (ws) => pressKey(ws, "Escape", 27, "Escape");

const readAriaExpanded = (ws) =>
  cdpEval(
    ws,
    `document.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') ?? null`
  );

async function waitAriaExpanded(ws, expected, timeoutMs = 3000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await readAriaExpanded(ws);
    if (last === expected) return last;
    await sleep(150);
  }
  return last;
}

async function openPanelByKeyboard(ws) {
  await enter(ws);
  if ((await waitAriaExpanded(ws, "true", 2000)) === "true") return "Enter";
  await space(ws);
  if ((await waitAriaExpanded(ws, "true", 2000)) === "true") return "Space";
  return null;
}

const isHamburger = (info) => String((info && info.cls) || "").includes("site-nav__hamburger");

async function tabTo(ws, predicate, maxTabs = 12) {
  for (let i = 0; i < maxTabs; i++) {
    await tab(ws);
    const info = await activeInfo(ws);
    if (predicate(info)) return { found: true, tabs: i + 1, info };
  }
  return { found: false, tabs: maxTabs, info: null };
}

async function waitForHydration(ws, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hamburgerVisible = await cdpEval(
      ws,
      `(() => {
        const b = document.querySelector('button[aria-expanded]');
        return !!b && getComputedStyle(b).display !== 'none';
      })()`
    ).catch(() => false);
    if (hamburgerVisible) {
      await clickHamburger(ws);
      if ((await waitAriaExpanded(ws, "true", 1200)) === "true") {
        await clickHamburger(ws);
        if ((await waitAriaExpanded(ws, "false", 1200)) === "false") return true;
      }
    } else {
      const scrolledClass = await cdpEval(
        ws,
        `(async () => {
          window.scrollTo(0, 600);
          await new Promise((r) => setTimeout(r, 350));
          const cls = document.querySelector('header.site-nav')?.className || '';
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 350));
          return String(cls);
        })()`
      ).catch(() => "");
      if (String(scrolledClass).includes("site-nav--scrolled")) return true;
    }
    await sleep(300);
  }
  return false;
}

async function resetFocus(ws) {
  await cdpEval(
    ws,
    `(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      return true;
    })()`
  );
  await sleep(120);
}

async function activeInfo(ws) {
  return cdpEval(
    ws,
    `(() => {
      const el = document.activeElement;
      const cs = el ? getComputedStyle(el) : null;
      const panel = document.getElementById('mobile-nav-panel');
      return {
        tag: el ? el.tagName : null,
        id: el ? el.id || null : null,
        text: el ? (el.textContent || '').trim().slice(0, 40) : null,
        href: el && el.getAttribute ? el.getAttribute('href') : null,
        cls: el && typeof el.className === 'string' ? el.className : null,
        inPanel: !!(panel && el && panel.contains(el)),
        outlineWidth: cs ? cs.outlineWidth : null,
        outlineStyle: cs ? cs.outlineStyle : null,
        outlineColor: cs ? cs.outlineColor : null,
        outlineOffset: cs ? cs.outlineOffset : null,
      };
    })()`
  );
}

async function navigate(ws, url, settleMs = 900) {
  const marker = `nav-probe-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  try {
    await cdpEval(ws, `window.__navProbeMarker = ${JSON.stringify(marker)}; true`);
  } catch {}
  await cdpSend(ws, "Page.navigate", { url });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    await sleep(250);
    try {
      const st = await cdpEval(
        ws,
        `({ ready: document.readyState, nav: !!document.querySelector('header.site-nav'), marker: window.__navProbeMarker || null })`
      );
      if (st.ready === "complete" && st.nav && st.marker !== marker) break;
    } catch {}
  }
  await sleep(settleMs);
}

async function clickHamburger(ws) {
  const r = await cdpEval(
    ws,
    `(() => {
      const b = document.querySelector('button[aria-expanded]');
      if (!b) return null;
      const rect = b.getBoundingClientRect();
      return { cx: Math.round(rect.x + rect.width / 2), cy: Math.round(rect.y + rect.height / 2) };
    })()`
  );
  if (!r) return false;
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: r.cx,
    y: r.cy,
    button: "left",
    clickCount: 1,
  });
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: r.cx,
    y: r.cy,
    button: "left",
    clickCount: 1,
  });
  await sleep(500);
  return true;
}

async function clickThemeToggle(ws) {
  const r = await cdpEval(
    ws,
    `(() => {
      const b = document.querySelector('.theme-toggle');
      if (!b) return null;
      const rect = b.getBoundingClientRect();
      return { cx: Math.round(rect.x + rect.width / 2), cy: Math.round(rect.y + rect.height / 2) };
    })()`
  );
  if (!r) return false;
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: r.cx,
    y: r.cy,
    button: "left",
    clickCount: 1,
  });
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: r.cx,
    y: r.cy,
    button: "left",
    clickCount: 1,
  });
  await sleep(300);
  return true;
}

async function readThemeState(ws) {
  return cdpEval(
    ws,
    `(() => {
      const b = document.querySelector('.theme-toggle');
      return {
        theme: document.documentElement.dataset.theme ?? null,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        stored: localStorage.getItem('theme'),
        label: b ? b.textContent.trim() : null,
        ariaLabel: b ? b.getAttribute('aria-label') : null,
        ariaPressed: b ? b.getAttribute('aria-pressed') : null,
      };
    })()`
  );
}

let failures = 0;
const results = {};
const durations = {};

// Console/Log capture populated by the ws listener in main() (see Log.enable).
const consoleErrors = [];
const clearConsoleErrors = () => {
  consoleErrors.length = 0;
};
const readConsoleErrors = () => [...consoleErrors];
const hydrationErrors = (list) =>
  list.filter((e) => /Minified React error|hydrat|#418|#423|#425/i.test(e.text));
const seriousErrors = (list) =>
  list.filter(
    (e) =>
      !/favicon|Failed to load resource.*404|net::ERR/i.test(e.text) &&
      !/Download the React DevTools/i.test(e.text)
  );

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

function shadowMaxBlur(value) {
  const v = String(value || "").startsWith("text:") ? value.slice(5) : String(value || "");
  let max = 0;
  for (const part of v.split(",")) {
    const nums = part.match(/-?\d*\.?\d+px/g) || [];
    if (nums.length >= 3) max = Math.max(max, parseFloat(nums[2]));
  }
  return max;
}

function durationMs(value) {
  if (!value) return NaN;
  const m = String(value).match(/(-?\d*\.?\d+(?:e[-+]?\d+)?)(ms|s)\b/i);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return m[2].toLowerCase() === "ms" ? n : n * 1000;
}

function walkSource(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkSource(p, out);
    else if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(e.name))) out.push(p);
  }
  return out;
}

function grepSource(pattern, dirs = [join(ROOT, "src")]) {
  const re = new RegExp(pattern);
  const hits = [];
  for (const dir of dirs) {
    for (const file of walkSource(dir)) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (re.test(line)) hits.push(`${file.replace(ROOT + "\\", "")}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return hits;
}

async function main() {
  freePortSync(PORT, "server");
  freePortSync(CDP_PORT, "cdp");
  await waitPortFree(PORT, 5000);
  await waitPortFree(CDP_PORT, 5000);

  if (SKIP_BUILD) {
    console.log("[probe] --skip-build: reusing existing .next");
    durations.buildMs = 0;
  } else {
    console.log("[probe] Building...");
    const buildStart = Date.now();
    try {
      execSync("npm run build", {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      const out = `${e.stdout || ""}\n${e.stderr || ""}`.trim();
      console.error("[probe] BUILD FAILED");
      console.error(out.slice(-4000));
      results.build = { pass: false, details: out.slice(-2000) };
      failures++;
      return;
    }
    durations.buildMs = Date.now() - buildStart;
  }
  const buildId = readFileSync(join(ROOT, ".next", "BUILD_ID"), "utf8").trim();
  console.log(`[probe] Build ready in ${durations.buildMs}ms BUILD_ID=${buildId}`);
  results.build = { pass: true, details: { buildMs: durations.buildMs, buildId } };

  console.log(`[probe] Starting server on ${PORT}`);
  const serverStart = Date.now();
  serverProc = spawn(
    process.execPath,
    [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(PORT)],
    { cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true }
  );

  let serverReady = false;
  let readyStatus = null;
  const readyUrl = MODE === "httpcheck" ? `http://127.0.0.1:${PORT}${HTTP_PATH}` : PAGE_URL;
  const srvT0 = Date.now();
  while (Date.now() - srvT0 < 60000) {
    await sleep(700);
    try {
      const res = await fetch(readyUrl, { redirect: "manual" });
      readyStatus = res.status;
      serverReady = true;
      break;
    } catch {}
  }
  durations.serverStartMs = Date.now() - serverStart;
  if (!serverReady) {
    console.error("[probe] Server did not start");
    results.server = { pass: false, details: `no HTTP response on ${readyUrl} within 60s` };
    failures++;
    return;
  }
  if (MODE !== "httpcheck" && readyStatus !== 200) {
    console.error(
      `[probe] ${PAGE_URL} returned ${readyStatus}. Restore the QA page first: copy ` +
        `.omo/evidence/task-5-nav-qa-page.fixture.tsx to src/app/nav-qa/page.tsx and rebuild.`
    );
    results.server = { pass: false, details: `/nav-qa returned ${readyStatus}, expected 200` };
    failures++;
    return;
  }
  console.log(`[probe] Server ready in ${durations.serverStartMs}ms (pid ${serverProc.pid})`);

  if (MODE === "httpcheck") {
    console.log(`[probe] HTTP check ${HTTP_PATH} expect ${HTTP_EXPECT}`);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}${HTTP_PATH}`, { redirect: "manual" });
      const body = await res.text();
      assert(
        "http-status",
        res.status === HTTP_EXPECT,
        `${HTTP_PATH} -> ${res.status} (expected ${HTTP_EXPECT}), body ${body.length} bytes`
      );
    } catch (e) {
      assert("http-status", false, e.message);
    }
    cleanupSync();
    await waitPortFree(PORT, 15000);
    console.log(`[probe] cleanup: port ${PORT} free=${portPids(PORT).length === 0}`);
    return;
  }

  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-nav-probe-"));
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
      "--window-size=1280,900",
    ],
    { detached: true, stdio: "ignore", windowsHide: true }
  );

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await resp.json();
      const page = targets.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }
  if (!wsUrl) {
    console.error("[probe] Chrome CDP not reachable");
    results.chrome = { pass: false, details: "no page target" };
    failures++;
    return;
  }
  console.log(`[probe] CDP connected: ${wsUrl} (pid ${chromeProc.pid})`);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  await cdpSend(ws, "Page.enable");
  await cdpSend(ws, "Runtime.enable");
  await cdpSend(ws, "DOM.enable");

  // --- Console / log error capture (hydration assertions in runThemeSuite) ---
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(typeof ev === "string" ? ev : ev.data);
    } catch {
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const type = msg.params?.type;
      if (type === "error") {
        const text = (msg.params.args || [])
          .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type || ""))
          .join(" ");
        consoleErrors.push({ source: "console.error", text });
      }
    } else if (msg.method === "Log.entryAdded") {
      const e = msg.params?.entry || {};
      if (e.level === "error") {
        consoleErrors.push({ source: "log.error", text: `${e.text || ""} ${e.url || ""}` });
      }
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails || {};
      consoleErrors.push({
        source: "exception",
        text: `${d.exception?.description || d.text || ""}`,
      });
    }
  });
  await safeSend(ws, "Log.enable");

  await safeSend(ws, "Page.bringToFront");
  await safeSend(ws, "Emulation.setFocusEmulationEnabled", { enabled: true });
  await setMedia(ws, "dark");

  try {
    if (MODE === "artifacts") {
      await runArtifactsSuite(ws);
    } else {
      await runDesktopSuite(ws);
      await runMobileSuite(ws);
      await runStaticChecks(ws);
      await runThemeSuite(ws);
    }
  } catch (err) {
    console.error("[probe] Test error:", err.message);
    results.uncaught = { pass: false, details: err.message };
    failures++;
  } finally {
    try {
      ws.close();
    } catch {}
    cleanupSync();
    await waitPortFree(PORT, 15000);
    await waitPortFree(CDP_PORT, 10000);
    console.log(
      `[probe] cleanup: port ${PORT} free=${portPids(PORT).length === 0}, port ${CDP_PORT} free=${portPids(CDP_PORT).length === 0}`
    );
  }
}

async function runDesktopSuite(ws) {
  console.log("\n[probe] === DESKTOP 1280x900 ===");
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await setMedia(ws, "dark");
  await navigate(ws, PAGE_URL);

  console.log("[probe] T1 skip-link first focusable");
  await resetFocus(ws);
  await tab(ws);
  const first = await activeInfo(ws);
  assert(
    "t1-skip-link-first-focusable",
    !!first.cls && first.cls.includes("skip-link") && first.href === "#main-content",
    JSON.stringify(first)
  );

  console.log("[probe] T2 skip-link focus styles");
  const skipStyles = await cdpEval(
    ws,
    `(() => {
      const a = document.querySelector('.skip-link');
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        background: cs.backgroundColor,
        color: cs.color,
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
      };
    })()`
  );
  assert(
    "t2-skip-link-focus-styles",
    skipStyles.top >= 0 &&
      skipStyles.top <= 40 &&
      skipStyles.background === AMBER &&
      skipStyles.color === INK_ON_AMBER &&
      skipStyles.outlineWidth === "2px" &&
      skipStyles.outlineStyle === "solid" &&
      skipStyles.outlineColor === AMBER &&
      skipStyles.outlineOffset === "2px",
    JSON.stringify(skipStyles)
  );

  console.log("[probe] T3 skip-link Enter -> #main-content");
  await enter(ws);
  await sleep(300);
  const mainFocus = await activeInfo(ws);
  assert(
    "t3-skip-link-moves-to-main",
    mainFocus.id === "main-content" && mainFocus.tag === "MAIN",
    JSON.stringify(mainFocus)
  );

  console.log("[probe] T4 landmarks");
  const landmarks = await cdpEval(
    ws,
    `(() => {
      const header = document.querySelector('header.site-nav');
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const main = document.getElementById('main-content');
      const footer = document.querySelector('footer');
      return {
        header: !!header,
        nav: !!nav,
        navCount: document.querySelectorAll('nav[aria-label="Primary"]').length,
        main: !!main,
        mainTabIndex: main ? main.tabIndex : null,
        footer: !!footer,
      };
    })()`
  );
  assert(
    "t4-landmarks",
    landmarks.header &&
      landmarks.nav &&
      landmarks.navCount === 1 &&
      landmarks.main &&
      landmarks.mainTabIndex === -1 &&
      landmarks.footer,
    JSON.stringify(landmarks)
  );

  console.log("[probe] T5 desktop visibility");
  const desktop = await cdpEval(
    ws,
    `(() => {
      const list = document.querySelector('.site-nav__links');
      const links = list ? [...list.querySelectorAll('a')] : [];
      const hamburger = document.querySelector('button[aria-expanded]');
      return {
        linkCount: links.length,
        hrefs: links.map((a) => a.getAttribute('href')),
        listDisplay: list ? getComputedStyle(list).display : null,
        hamburgerDisplay: hamburger ? getComputedStyle(hamburger).display : null,
      };
    })()`
  );
  assert(
    "t5-desktop-links-visible",
    desktop.linkCount === 5 &&
      desktop.listDisplay === "flex" &&
      desktop.hrefs.join(",") === "/,/work,/about,/stack,/contact",
    JSON.stringify(desktop)
  );
  assert(
    "t5b-desktop-hamburger-hidden",
    desktop.hamburgerDisplay === "none",
    `display=${desktop.hamburgerDisplay}`
  );

  console.log("[probe] T6 no nested interactive + CTA is anchor");
  const nesting = await cdpEval(
    ws,
    `(() => {
      const nav = document.querySelector('nav[aria-label="Primary"]');
      if (!nav) return { nav: false };
      const nested = nav.querySelectorAll('a a, a button, button a, button button');
      const cta = nav.querySelector('.site-nav__cta-link');
      return {
        nav: true,
        nestedCount: nested.length,
        nestedSamples: [...nested].slice(0, 3).map((el) => el.tagName + '.' + (el.className || '')),
        ctaTag: cta ? cta.tagName : null,
        ctaHref: cta ? cta.getAttribute('href') : null,
        ctaClass: cta ? cta.className : null,
        ctaText: cta ? cta.textContent.trim() : null,
      };
    })()`
  );
  assert(
    "t6-no-nested-interactive",
    nesting.nav &&
      nesting.nestedCount === 0 &&
      nesting.ctaTag === "A" &&
      nesting.ctaHref === "/contact" &&
      nesting.ctaText === "HIRE ME" &&
      String(nesting.ctaClass).includes("neo-pixel-btn"),
    JSON.stringify(nesting)
  );

  console.log("[probe] T7 sticky nav");
  const sticky = await cdpEval(
    ws,
    `(() => {
      const h = document.querySelector('header.site-nav');
      const cs = getComputedStyle(h);
      return { position: cs.position, zIndex: cs.zIndex };
    })()`
  );
  assert(
    "t7-nav-sticky",
    (sticky.position === "sticky" || sticky.position === "fixed") && sticky.zIndex === "50",
    JSON.stringify(sticky)
  );

  console.log("[probe] T8 focus-visible ring via real Tab");
  await navigate(ws, PAGE_URL);
  await resetFocus(ws);
  await tab(ws);
  await tab(ws);
  await tab(ws);
  const ringFocus = await activeInfo(ws);
  assert(
    "t8-focus-visible-ring",
    !!ringFocus.cls &&
      ringFocus.cls.includes("site-nav__link") &&
      ringFocus.outlineWidth === "2px" &&
      ringFocus.outlineStyle === "solid" &&
      ringFocus.outlineColor === AMBER &&
      ringFocus.outlineOffset === "2px",
    JSON.stringify(ringFocus)
  );

  console.log("[probe] T9 hover amber underline");
  const linkRect = await cdpEval(
    ws,
    `(() => {
      const l = document.querySelector('.site-nav__links .site-nav__link');
      const r = l.getBoundingClientRect();
      return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
    })()`
  );
  const readLink = () =>
    cdpEval(
      ws,
      `(() => {
        const l = document.querySelector('.site-nav__links .site-nav__link');
        const cs = getComputedStyle(l);
        return { borderBottomColor: cs.borderBottomColor, borderBottomWidth: cs.borderBottomWidth };
      })()`
    );
  await cdpSend(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 400 });
  await sleep(120);
  const hoverBefore = await readLink();
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: linkRect.cx,
    y: linkRect.cy,
  });
  await sleep(300);
  const hoverAfter = await readLink();
  assert(
    "t9-hover-amber-underline",
    hoverBefore.borderBottomColor === "rgba(0, 0, 0, 0)" &&
      hoverAfter.borderBottomColor === AMBER &&
      hoverAfter.borderBottomWidth === "2px",
    JSON.stringify({ hoverBefore, hoverAfter })
  );

  console.log("[probe] T10 solid-after-scroll via IntersectionObserver");
  await cdpEval(ws, `window.scrollTo(0, 600)`);
  await sleep(700);
  const scrolled = await cdpEval(
    ws,
    `(() => {
      const h = document.querySelector('header.site-nav');
      const cs = getComputedStyle(h);
      const r = h.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bg: cs.backgroundColor,
        border: cs.borderBottomColor,
        cls: h.className,
        transitionDuration: cs.transitionDuration,
      };
    })()`
  );
  assert(
    "t10a-nav-solid-after-scroll",
    scrolled.top === 0 &&
      String(scrolled.cls).includes("site-nav--scrolled") &&
      scrolled.bg === PANEL_BG &&
      scrolled.border === BORDER_BG,
    JSON.stringify(scrolled)
  );
  assert(
    "t10b-no-non-gpu-transition",
    scrolled.transitionDuration === "0s",
    `header transition-duration=${scrolled.transitionDuration}`
  );

  await cdpEval(ws, `window.scrollTo(0, 0)`);
  await sleep(700);
  const unscrolled = await cdpEval(
    ws,
    `(() => {
      const h = document.querySelector('header.site-nav');
      const cs = getComputedStyle(h);
      return { bg: cs.backgroundColor, cls: h.className };
    })()`
  );
  assert(
    "t10c-transparent-at-top",
    unscrolled.bg === "rgba(0, 0, 0, 0)" && !String(unscrolled.cls).includes("site-nav--scrolled"),
    JSON.stringify(unscrolled)
  );

  console.log("[probe] T11 active route");
  await navigate(ws, `http://127.0.0.1:${PORT}/work`);
  const activeDark = await cdpEval(
    ws,
    `(() => {
      const els = [...document.querySelectorAll('.site-nav__links .site-nav__link--active')];
      const el = els[0];
      return {
        theme: document.documentElement.dataset.theme,
        count: els.length,
        text: el ? el.textContent.trim() : null,
        href: el ? el.getAttribute('href') : null,
        color: el ? getComputedStyle(el).color : null,
      };
    })()`
  );
  assert(
    "t11a-active-route-amber-dark",
    activeDark.theme === "dark" &&
      activeDark.count === 1 &&
      activeDark.text === "Work" &&
      activeDark.href === "/work" &&
      activeDark.color === AMBER,
    JSON.stringify(activeDark)
  );

  // NATURAL light path (FIX 2): no manual dataset injection. Fresh load with
  // media=light + no stored theme; the inline §2.5 script sets data-theme and
  // it must SURVIVE hydration.
  await cdpEval(ws, `localStorage.removeItem('theme'); true`);
  await setMedia(ws, "light");
  await navigate(ws, `http://127.0.0.1:${PORT}/work`);
  await sleep(1500);
  const activeLight = await cdpEval(
    ws,
    `(() => {
      const el = document.querySelector('.site-nav__links .site-nav__link--active');
      return {
        theme: document.documentElement.dataset.theme ?? null,
        count: document.querySelectorAll('.site-nav__links .site-nav__link--active').length,
        text: el ? el.textContent.trim() : null,
        href: el ? el.getAttribute('href') : null,
        color: el ? getComputedStyle(el).color : null,
        border: el ? getComputedStyle(el).borderBottomColor : null,
      };
    })()`
  );
  assert(
    "t11b-active-route-light-underline",
    activeLight.theme === "light" &&
      activeLight.count === 1 &&
      activeLight.text === "Work" &&
      activeLight.href === "/work" &&
      activeLight.color === "rgb(26, 25, 24)" &&
      activeLight.border === "rgb(217, 119, 6)",
    JSON.stringify({ activeLight })
  );
  await cdpEval(ws, `localStorage.removeItem('theme'); true`);
  await setMedia(ws, "dark");

  console.log("[probe] T12 theme toggle keyboard reachable");
  await navigate(ws, PAGE_URL);
  await resetFocus(ws);
  for (let i = 0; i < 8; i++) await tab(ws);
  const toggleFocus = await cdpEval(
    ws,
    `(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        cls: typeof el.className === 'string' ? el.className : null,
        ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null,
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
      };
    })()`
  );
  assert(
    "t12-theme-toggle-focus-ring",
    !!toggleFocus.cls &&
      toggleFocus.cls.includes("theme-toggle") &&
      toggleFocus.ariaLabel &&
      toggleFocus.ariaLabel.startsWith("Toggle theme") &&
      toggleFocus.outlineWidth === "2px" &&
      toggleFocus.outlineStyle === "solid" &&
      toggleFocus.outlineColor === AMBER &&
      toggleFocus.outlineOffset === "2px",
    JSON.stringify(toggleFocus)
  );
}

async function runMobileSuite(ws) {
  console.log("\n[probe] === MOBILE 375x812 ===");
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await setMedia(ws, "dark");
  await navigate(ws, PAGE_URL);

  console.log("[probe] waiting for hydration...");
  const hydrated = await waitForHydration(ws);
  assert("t12b-hydration", hydrated, `hydration confirmed=${hydrated}`);

  console.log("[probe] T13 hamburger visible + closed + aria-controls");
  const hamburgerInit = await cdpEval(
    ws,
    `(() => {
      const b = document.querySelector('button[aria-expanded]');
      const panel = document.getElementById('mobile-nav-panel');
      return {
        exists: !!b,
        display: b ? getComputedStyle(b).display : null,
        ariaExpanded: b ? b.getAttribute('aria-expanded') : null,
        ariaControls: b ? b.getAttribute('aria-controls') : null,
        ariaLabel: b ? b.getAttribute('aria-label') : null,
        panelExists: !!panel,
        panelInertAttr: panel ? panel.hasAttribute('inert') : null,
        panelDisplay: panel ? getComputedStyle(panel).display : null,
      };
    })()`
  );
  assert(
    "t13-hamburger-closed",
    hamburgerInit.exists &&
      (hamburgerInit.display === "flex" || hamburgerInit.display === "inline-flex") &&
      hamburgerInit.ariaExpanded === "false" &&
      hamburgerInit.ariaControls === "mobile-nav-panel" &&
      hamburgerInit.ariaLabel === "Menu" &&
      hamburgerInit.panelExists &&
      hamburgerInit.panelInertAttr === true &&
      hamburgerInit.panelDisplay === "none",
    JSON.stringify(hamburgerInit)
  );

  console.log("[probe] T14 closed panel links are NOT tabbable (real Tab sweep)");
  await resetFocus(ws);
  const stops = [];
  for (let i = 0; i < 14; i++) {
    await tab(ws);
    const info = await activeInfo(ws);
    stops.push({ tag: info.tag, cls: info.cls, text: info.text, inPanel: info.inPanel });
  }
  const panelStops = stops.filter((s) => s.inPanel);
  const sawHamburger = stops.some((s) => String(s.cls).includes("site-nav__hamburger"));
  assert(
    "t14a-closed-panel-not-tabbable",
    panelStops.length === 0,
    JSON.stringify({ panelStops, stops })
  );
  assert("t14b-hamburger-keyboard-reachable", sawHamburger, JSON.stringify({ stops }));

  console.log("[probe] T15 open panel via keyboard");
  await navigate(ws, PAGE_URL);
  await waitForHydration(ws);
  await resetFocus(ws);
  const tabToHamburger = await tabTo(ws, isHamburger);
  const preEnter = tabToHamburger.info;
  const openKey = tabToHamburger.found ? await openPanelByKeyboard(ws) : null;
  await sleep(600);
  const opened = await cdpEval(
    ws,
    `(() => {
      const b = document.querySelector('button[aria-expanded]');
      const panel = document.getElementById('mobile-nav-panel');
      const h = document.querySelector('header.site-nav');
      const pr = panel.getBoundingClientRect();
      const hr = h.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      return {
        ariaExpanded: b.getAttribute('aria-expanded'),
        panelInertAttr: panel.hasAttribute('inert'),
        panelDisplay: cs.display,
        panelClass: panel.className,
        headerClass: h.className,
        headerBg: getComputedStyle(h).backgroundColor,
        panelHeight: Math.round(pr.height),
        headerHeight: Math.round(hr.height),
        viewportHeight: window.innerHeight,
        animDuration: cs.animationDuration,
        animTiming: cs.animationTimingFunction,
      };
    })()`
  );
  assert(
    "t15a-keyboard-opens-panel",
    !!openKey &&
      tabToHamburger.found &&
      preEnter.cls &&
      preEnter.cls.includes("site-nav__hamburger") &&
      opened.ariaExpanded === "true" &&
      opened.panelInertAttr === false &&
      opened.panelDisplay === "flex" &&
      String(opened.panelClass).includes("site-nav__panel--open"),
    JSON.stringify({ tabToHamburger: { found: tabToHamburger.found, tabs: tabToHamburger.tabs, cls: preEnter.cls }, openKey, opened })
  );
  assert(
    "t15b-panel-full-height",
    opened.panelHeight >= opened.viewportHeight - opened.headerHeight - 5,
    `panel=${opened.panelHeight} header=${opened.headerHeight} viewport=${opened.viewportHeight}`
  );
  assert(
    "t15c-panel-motion-200ms-steps4",
    durationMs(opened.animDuration) === 200 && String(opened.animTiming).includes("steps(4)"),
    `duration=${opened.animDuration} timing=${opened.animTiming}`
  );
  assert(
    "t15d-header-solid-when-open",
    String(opened.headerClass).includes("site-nav--panel-open") &&
      opened.headerBg === PANEL_BG,
    JSON.stringify({ headerClass: opened.headerClass, headerBg: opened.headerBg })
  );

  console.log("[probe] T16 open panel links ARE tabbable");
  await tab(ws);
  const panelLinkFocus = await activeInfo(ws);
  assert(
    "t16-open-panel-tabbable",
    panelLinkFocus.inPanel === true &&
      panelLinkFocus.tag === "A" &&
      String(panelLinkFocus.cls).includes("site-nav__link"),
    JSON.stringify(panelLinkFocus)
  );

  console.log("[probe] T17 Escape closes + returns focus to hamburger");
  await escapeKey(ws);
  await sleep(600);
  const afterEscape = await cdpEval(
    ws,
    `(() => {
      const b = document.querySelector('button[aria-expanded]');
      const panel = document.getElementById('mobile-nav-panel');
      return {
        ariaExpanded: b.getAttribute('aria-expanded'),
        panelInertAttr: panel.hasAttribute('inert'),
        focusIsHamburger: document.activeElement === b,
        focusTag: document.activeElement ? document.activeElement.tagName : null,
      };
    })()`
  );
  assert(
    "t17-escape-closes-returns-focus",
    afterEscape.ariaExpanded === "false" &&
      afterEscape.panelInertAttr === true &&
      afterEscape.focusIsHamburger === true,
    JSON.stringify(afterEscape)
  );

  console.log("[probe] T18 panel link click closes panel on route change");
  const openKey2 = await openPanelByKeyboard(ws);
  await sleep(600);
  const reopened = await readAriaExpanded(ws);
  await tab(ws);
  const targetLink = await cdpEval(
    ws,
    `(() => {
      const el = document.activeElement;
      return { inPanel: document.getElementById('mobile-nav-panel').contains(el), href: el.getAttribute('href'), text: el.textContent.trim() };
    })()`
  );
  await enter(ws);
  await sleep(1200);
  const afterNav = await cdpEval(
    ws,
    `(() => {
      const b = document.querySelector('button[aria-expanded]');
      return {
        ariaExpanded: b ? b.getAttribute('aria-expanded') : null,
        pathname: location.pathname,
      };
    })()`
  );
  assert(
    "t18-link-click-closes-panel",
    !!openKey2 &&
      reopened === "true" &&
      targetLink.inPanel === true &&
      afterNav.ariaExpanded === "false" &&
      afterNav.pathname === "/",
    JSON.stringify({ openKey2, reopened, targetLink, afterNav })
  );

  console.log("[probe] T19 reduced motion collapses panel animation");
  await setMedia(ws, "dark", "reduce");
  await navigate(ws, PAGE_URL);
  await waitForHydration(ws);
  await resetFocus(ws);
  const tabToHamburger3 = await tabTo(ws, isHamburger);
  const openKey3 = tabToHamburger3.found ? await openPanelByKeyboard(ws) : null;
  await sleep(400);
  const reduced = await cdpEval(
    ws,
    `(() => {
      const panel = document.getElementById('mobile-nav-panel');
      const b = document.querySelector('button[aria-expanded]');
      const cs = getComputedStyle(panel);
      return {
        ariaExpanded: b.getAttribute('aria-expanded'),
        panelDisplay: cs.display,
        animDuration: cs.animationDuration,
        transDuration: cs.transitionDuration,
      };
    })()`
  );
  assert(
    "t19-reduced-motion",
    !!openKey3 &&
      reduced.ariaExpanded === "true" &&
      reduced.panelDisplay === "flex" &&
      durationMs(reduced.animDuration) <= 0.02,
    JSON.stringify({ openKey3, reduced })
  );
  await escapeKey(ws);
  await sleep(300);
  await setMedia(ws, "dark");

  console.log("[probe] T20 no blur > 24px on nav surfaces");
  await navigate(ws, PAGE_URL);
  const shadows = await cdpEval(
    ws,
    `(() => {
      const els = [
        document.querySelector('header.site-nav'),
        document.getElementById('mobile-nav-panel'),
        document.querySelector('.site-nav__hamburger'),
        document.querySelector('.theme-toggle'),
      ].filter(Boolean);
      return els.map((el) => ({ cls: el.className, shadow: getComputedStyle(el).boxShadow }));
    })()`
  );
  const blurViolations = shadows.filter((s) => shadowMaxBlur(s.shadow) > 24);
  assert(
    "t20-no-blur-over-24",
    blurViolations.length === 0,
    JSON.stringify({ shadows, blurViolations })
  );

  console.log("[probe] T21 nav still sticky on mobile");
  const mobileSticky = await cdpEval(
    ws,
    `(() => {
      const h = document.querySelector('header.site-nav');
      return { position: getComputedStyle(h).position };
    })()`
  );
  assert(
    "t21-mobile-sticky",
    mobileSticky.position === "sticky" || mobileSticky.position === "fixed",
    JSON.stringify(mobileSticky)
  );
}

async function runStaticChecks(ws) {
  console.log("\n[probe] === STATIC SOURCE CHECKS ===");

  console.log("[probe] T22 no scroll event listeners");
  const scrollHits = grepSource("addEventListener\\(\\s*['\"]scroll['\"]");
  assert("t22-no-scroll-listeners", scrollHits.length === 0, JSON.stringify(scrollHits));

  console.log("[probe] T23 no layout-animating properties in nav CSS");
  const navCss = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8");
  const navSection = navCss.slice(navCss.indexOf("Site Nav"));
  const layoutAnimated = [];
  for (const block of navSection.split("}")) {
    if (!/animation|transition/.test(block)) continue;
    const decl = block.match(/transition[^;]*;|animation[^;]*;/g) || [];
    for (const d of decl) {
      if (/\b(width|height|margin|padding|top|left|bottom|right)\b/.test(d) && !/translate/.test(d)) {
        layoutAnimated.push(d.trim());
      }
    }
  }
  assert(
    "t23-gpu-only-motion",
    layoutAnimated.length === 0,
    JSON.stringify({ layoutAnimated })
  );

  console.log("[probe] T24 no hex literals in SiteNav.tsx");
  const navSrc = readFileSync(join(ROOT, "src", "components", "SiteNav.tsx"), "utf8");
  const hexHits = (navSrc.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(
    (h) => !/^#(main-content|mobile-nav-panel)$/.test(h)
  );
  assert("t24-no-hex-outside-spec", hexHits.length === 0, JSON.stringify(hexHits));

  console.log("[probe] T25 IntersectionObserver present, scroll listener absent in SiteNav");
  const ioHits = grepSource("IntersectionObserver", [join(ROOT, "src", "components")]);
  assert(
    "t25-intersection-observer",
    ioHits.some((h) => h.includes("SiteNav.tsx")),
    JSON.stringify(ioHits)
  );

  console.log("[probe] T26 layout wiring preserved");
  const layoutSrc = readFileSync(join(ROOT, "src", "app", "layout.tsx"), "utf8");
  assert(
    "t26-layout-wired",
    layoutSrc.includes("<SiteNav />") &&
      layoutSrc.includes('id="main-content"') &&
      layoutSrc.includes("tabIndex={-1}") &&
      layoutSrc.includes("Maulana Faris"),
    "layout.tsx wired with SiteNav, main#main-content, site name present"
  );

  console.log("[probe] T27 BUILD_ID consistency between server and disk");
  const diskBuildId = readFileSync(join(ROOT, ".next", "BUILD_ID"), "utf8").trim();
  const servedHtml = await (await fetch(PAGE_URL)).text();
  const servedBuildId = servedHtml.includes(diskBuildId) ? diskBuildId : null;
  assert(
    "t27-build-id-matches-served",
    !!servedBuildId && servedBuildId === diskBuildId,
    `disk=${diskBuildId} served=${servedBuildId}`
  );
}

// ==========================================================================
// THEME SUITE (FIX 2) — NATURAL light-path tests, NO manual dataset injection.
// Gates the React 19 hydration defect: SSR must render theme-neutral markup,
// the inline §2.5 script's data-theme attribute must SURVIVE hydration, and
// the toggle must still work post-mount.
// ==========================================================================
async function runThemeSuite(ws) {
  console.log("\n[probe] === THEME / HYDRATION (natural paths, no injection) ===");
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  console.log("[probe] L0 SSR HTML is theme-neutral (no DARK/LIGHT in toggle)");
  const ssrHtml = await (await fetch(PAGE_URL)).text();
  const btnMatch = ssrHtml.match(/<button[^>]*theme-toggle[^>]*>([\s\S]*?)<\/button>/);
  const ssrLabel = btnMatch ? btnMatch[1].replace(/<[^>]+>/g, "").trim() : null;
  assert(
    "l0-ssr-theme-neutral",
    btnMatch !== null && !/DARK|LIGHT/i.test(String(ssrLabel)),
    JSON.stringify({ found: !!btnMatch, ssrLabel })
  );

  // --- L1: natural light path — fresh load, prefers-color-scheme=light, no storage ---
  console.log("[probe] L1 natural light path: clear storage + media=light + fresh load");
  await navigate(ws, PAGE_URL); // land on-origin so localStorage is clearable
  await cdpEval(ws, `localStorage.removeItem('theme'); true`);
  await setMedia(ws, "light");
  clearConsoleErrors();
  await navigate(ws, PAGE_URL);
  await sleep(1500); // past the ~192ms post-hydration wipe window
  const l1 = await readThemeState(ws);
  const l1Errors = seriousErrors(readConsoleErrors());
  const l1Hydration = hydrationErrors(l1Errors);
  assert("l1a-natural-light-attribute-survives", l1.theme === "light", JSON.stringify({ l1 }));
  assert(
    "l1b-natural-light-tokens-applied",
    l1.bodyBg === LIGHT_CANVAS,
    JSON.stringify({ bodyBg: l1.bodyBg, expected: LIGHT_CANVAS })
  );
  assert(
    "l1c-natural-light-no-hydration-error",
    l1Hydration.length === 0 && l1Errors.length === 0,
    JSON.stringify({ hydration: l1Hydration, errors: l1Errors })
  );
  assert(
    "l1d-natural-light-label-synced",
    l1.label === "LIGHT" &&
      l1.ariaLabel &&
      l1.ariaLabel.startsWith("Toggle theme") &&
      l1.ariaLabel.toLowerCase().includes(l1.label.toLowerCase()),
    JSON.stringify({ label: l1.label, ariaLabel: l1.ariaLabel })
  );

  // --- L2: stored-light variant — localStorage theme=light, media=dark, reload ---
  console.log("[probe] L2 stored light: localStorage=light + media=dark + reload");
  await cdpEval(ws, `localStorage.setItem('theme', 'light'); true`);
  await setMedia(ws, "dark");
  clearConsoleErrors();
  await navigate(ws, PAGE_URL);
  await sleep(1500);
  const l2 = await readThemeState(ws);
  const l2Errors = seriousErrors(readConsoleErrors());
  const l2Hydration = hydrationErrors(l2Errors);
  assert("l2a-stored-light-attribute-survives", l2.theme === "light", JSON.stringify({ l2 }));
  assert(
    "l2b-stored-light-tokens-applied",
    l2.bodyBg === LIGHT_CANVAS,
    JSON.stringify({ bodyBg: l2.bodyBg, expected: LIGHT_CANVAS })
  );
  assert(
    "l2c-stored-light-no-hydration-error",
    l2Hydration.length === 0 && l2Errors.length === 0,
    JSON.stringify({ hydration: l2Hydration, errors: l2Errors })
  );

  // --- L3: toggle still works post-mount (natural click, from light state) ---
  console.log("[probe] L3 toggle works post-mount (light -> dark -> light)");
  const clicked1 = await clickThemeToggle(ws);
  const l3a = await readThemeState(ws);
  assert(
    "l3a-toggle-light-to-dark",
    clicked1 && l3a.theme === "dark" && l3a.bodyBg === DARK_CANVAS && l3a.stored === "dark",
    JSON.stringify({ clicked1, l3a })
  );
  const clicked2 = await clickThemeToggle(ws);
  const l3b = await readThemeState(ws);
  assert(
    "l3b-toggle-dark-to-light",
    clicked2 && l3b.theme === "light" && l3b.bodyBg === LIGHT_CANVAS && l3b.stored === "light",
    JSON.stringify({ clicked2, l3b })
  );

  // Restore neutral state for anything that might run after.
  await cdpEval(ws, `localStorage.removeItem('theme'); true`);
  await setMedia(ws, "dark");
}

async function readNavState(ws) {
  return cdpEval(
    ws,
    `(() => {
      const h = document.querySelector('header.site-nav');
      const cs = h ? getComputedStyle(h) : null;
      const b = document.querySelector('button[aria-expanded]');
      const panel = document.getElementById('mobile-nav-panel');
      const skip = document.querySelector('.skip-link');
      const skcs = skip ? getComputedStyle(skip) : null;
      const active = document.querySelector('.site-nav__link--active');
      const link = document.querySelector('.site-nav__links .site-nav__link');
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        scrollY: Math.round(window.scrollY),
        theme: document.documentElement.dataset.theme,
        header: {
          position: cs ? cs.position : null,
          zIndex: cs ? cs.zIndex : null,
          bg: cs ? cs.backgroundColor : null,
          border: cs ? cs.borderBottomColor : null,
          cls: h ? h.className : null,
          top: h ? Math.round(h.getBoundingClientRect().top) : null,
        },
        hamburger: {
          exists: !!b,
          ariaExpanded: b ? b.getAttribute('aria-expanded') : null,
          display: b ? getComputedStyle(b).display : null,
        },
        panel: {
          inert: panel ? panel.hasAttribute('inert') : null,
          display: panel ? getComputedStyle(panel).display : null,
          height: panel ? Math.round(panel.getBoundingClientRect().height) : null,
        },
        skipLink: {
          top: skip ? Math.round(skip.getBoundingClientRect().top) : null,
          outlineWidth: skcs ? skcs.outlineWidth : null,
          outlineStyle: skcs ? skcs.outlineStyle : null,
          outlineColor: skcs ? skcs.outlineColor : null,
          outlineOffset: skcs ? skcs.outlineOffset : null,
        },
        navLink: {
          outlineWidth: link ? getComputedStyle(link).outlineWidth : null,
          outlineStyle: link ? getComputedStyle(link).outlineStyle : null,
          outlineColor: link ? getComputedStyle(link).outlineColor : null,
          outlineOffset: link ? getComputedStyle(link).outlineOffset : null,
        },
        activeLink: active
          ? { text: active.textContent.trim(), color: getComputedStyle(active).color }
          : null,
      };
    })()`
  );
}

async function captureScreenshot(ws, path) {
  const res = await cdpSend(ws, "Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(res.data, "base64");
  writeFileSync(path, buf);
  console.log(`[probe] screenshot -> ${path} (${buf.length} bytes)`);
}

async function runArtifactsSuite(ws) {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[probe] === ARTIFACTS -> ${OUT_DIR} ===`);
  const styles = { capturedAt: new Date().toISOString(), buildId: readFileSync(join(ROOT, ".next", "BUILD_ID"), "utf8").trim() };

  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await setMedia(ws, "dark");
  await navigate(ws, PAGE_URL);
  console.log("[probe] waiting for hydration (desktop artifacts)...");
  styles.desktopHydrated = await waitForHydration(ws);
  styles.desktopTop = await readNavState(ws);

  await cdpEval(ws, `window.scrollTo(0, 600)`);
  await sleep(800);
  styles.desktopScrolled = await readNavState(ws);
  await cdpEval(ws, `window.scrollTo(0, 0)`);
  await sleep(700);
  styles.desktopBackToTop = await readNavState(ws);

  await resetFocus(ws);
  await tab(ws);
  styles.skipLinkFocused = await cdpEval(
    ws,
    `(() => {
      const a = document.querySelector('.skip-link');
      const cs = getComputedStyle(a);
      return {
        top: Math.round(a.getBoundingClientRect().top),
        bg: cs.backgroundColor,
        color: cs.color,
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
      };
    })()`
  );
  await tab(ws);
  await tab(ws);
  styles.navLinkFocused = await cdpEval(
    ws,
    `(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim(),
        cls: typeof el.className === 'string' ? el.className : null,
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
      };
    })()`
  );
  const html = await cdpEval(ws, `document.documentElement.outerHTML`);
  writeFileSync(join(OUT_DIR, "task-5-dom-dump.html"), html);
  console.log(`[probe] dom dump -> ${join(OUT_DIR, "task-5-dom-dump.html")} (${html.length} bytes)`);

  await captureScreenshot(ws, join(OUT_DIR, "task-5-screenshot-1280.png"));

  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await navigate(ws, PAGE_URL);
  console.log("[probe] waiting for hydration (mobile artifacts)...");
  styles.mobileHydrated = await waitForHydration(ws);
  styles.mobileClosed = await readNavState(ws);
  await captureScreenshot(ws, join(OUT_DIR, "task-5-screenshot-375.png"));

  await clickHamburger(ws);
  await waitAriaExpanded(ws, "true", 2000);
  styles.mobileOpen = await readNavState(ws);
  await captureScreenshot(ws, join(OUT_DIR, "task-5-screenshot-375-open.png"));

  await escapeKey(ws);
  await sleep(500);
  styles.mobileAfterEscape = await readNavState(ws);

  writeFileSync(
    join(OUT_DIR, "task-5-nav-styles.json"),
    JSON.stringify(styles, null, 2)
  );
  console.log(`[probe] styles -> ${join(OUT_DIR, "task-5-nav-styles.json")}`);
}

main()
  .then(async () => {
    clearTimeout(watchdog);
    console.log(
      "\n" +
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            failures,
            pass: failures === 0,
            durations,
            results,
          },
          null,
          2
        )
    );
    if (failures > 0) {
      console.log(`\n[probe] FAIL — ${failures} assertion(s) failed`);
      process.exit(1);
    } else {
      console.log(`\n[probe] PASS — all assertions passed`);
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error("[probe] FATAL:", err && err.stack ? err.stack : err);
    cleanupSync();
    process.exit(1);
  });





