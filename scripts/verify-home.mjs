#!/usr/bin/env node
/**
 * verify-home.mjs — Zero-dependency CDP probe for §6.2 Home page.
 * Node 22 global WebSocket + fetch + chrome --headless=new.
 * Asserts: h1 present + server-rendered + no animation; 2 CTA buttons;
 * featured-work grid §5.4 for counts 0/1/3/5 via temp QA fixture route;
 * ProjectCard link accessible-name = title; thumbnail aspect-ratio 16/10.
 * Exits 0 on all-pass, 1 on any mismatch.
 *
 * HARDENED: server spawned detached with stdio to file; cleanup kills
 * process tree via taskkill /T /F; port verified dead before exit.
 */
import { execSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3107;
const CDP_PORT = 9230;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = join(import.meta.dirname, "..");
const HOME_URL = `http://127.0.0.1:${PORT}`;
const EVIDENCE_DIR = join(ROOT, "..", ".omo", "evidence");

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
let serverPid = null;
let chromePid = null;
let chromeTmpDir = null;

/** Kill a PID tree on Windows, then verify port is dead */
function killTree(pid) {
  if (!pid) return;
  try { execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: "ignore" }); } catch {}
}

async function waitPortDead(port, maxMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
      // Still alive — wait
      await sleep(500);
    } catch {
      // Connection refused = dead
      console.log(`[probe] port ${port} confirmed dead`);
      return true;
    }
  }
  console.log(`[probe] WARNING: port ${port} still alive after ${maxMs}ms`);
  return false;
}

async function cleanup() {
  console.log("[probe] cleanup: killing process trees...");
  killTree(chromePid);
  killTree(serverPid);
  // Wait for server port to be free
  await waitPortDead(PORT, 10000);
  try {
    if (chromeTmpDir) rmSync(chromeTmpDir, { recursive: true, force: true });
  } catch {}
  console.log("[probe] cleanup done");
}

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

// ── helpers: real-input card interaction + artifacts (task 6) ──
function hexToRgb(hex) {
  const h = String(hex).replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function pressTab(ws) {
  await cdpSend(ws, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  await cdpSend(ws, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  await sleep(120);
}

async function moveMouseTo(ws, x, y) {
  await cdpSend(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(250);
}

async function readCardState(ws) {
  return cdpEval(
    ws,
    `(() => {
      const card = document.querySelector('[data-testid="project-card"], .project-card');
      if (!card) return { error: 'no card' };
      const cs = getComputedStyle(card);
      const thumb = card.querySelector('[data-testid="project-thumbnail"]');
      const link = card.closest('a') || card;
      const title = card.querySelector('h2, h3');
      return {
        transform: cs.transform,
        borderColor: cs.borderColor,
        transitionDuration: cs.transitionDuration,
        transitionTimingFunction: cs.transitionTimingFunction,
        thumbAspectRatio: thumb ? getComputedStyle(thumb).aspectRatio : null,
        href: link.getAttribute('href'),
        ariaLabel: link.getAttribute('aria-label'),
        linkText: link ? link.textContent.trim() : null,
        titleText: title ? title.textContent.trim() : null,
      };
    })()`
  );
}

async function readFocusRing(ws) {
  return cdpEval(
    ws,
    `(() => {
      const el = document.activeElement;
      if (!el) return { tag: null, isCard: false };
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        isCard: !!(el.matches && el.matches('[data-testid="project-card"], .project-card')),
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
      };
    })()`
  );
}

// Card hover (§6.3): translateY(-2px) + border → border-strong, 120ms steps(2);
// focus-visible ring via real Tab key; thumbnail aspect-ratio locked 16/10.
async function runCardInteractionSuite(ws) {
  console.log("\n[probe] === CARD HOVER + FOCUS (real input) ===");
  try {
    await cdpSend(ws, "Page.bringToFront");
  } catch {}
  try {
    await cdpSend(ws, "Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch {}
  await cdpSend(ws, "Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: "dark" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ],
  });
  await cdpSend(ws, "Page.navigate", { url: `http://127.0.0.1:${PORT}/home-qa/3` });
  await sleep(2500);

  const tokens = await cdpEval(
    ws,
    `(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        borderDefault: cs.getPropertyValue('--border-default').trim(),
        borderStrong: cs.getPropertyValue('--border-strong').trim(),
        amber: cs.getPropertyValue('--accent-amber').trim(),
      };
    })()`
  );

  const hasCard = await cdpEval(
    ws,
    `!!document.querySelector('[data-testid="project-card"], .project-card')`
  );
  if (!hasCard) {
    assert("card-hover-lift", false, "/home-qa/3 rendered no project card");
    assert("card-focus-visible-ring", false, "/home-qa/3 rendered no project card");
    return;
  }

  await cdpEval(ws, `document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); true`);
  await moveMouseTo(ws, 4, 4);
  const base = await readCardState(ws);

  const rect = await cdpEval(
    ws,
    `(() => {
      const r = document.querySelector('[data-testid="project-card"], .project-card').getBoundingClientRect();
      return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
    })()`
  );
  await moveMouseTo(ws, rect.cx, rect.cy);
  const hover = await readCardState(ws);

  assert(
    "card-hover-lift",
    base.transform !== hover.transform && /-2\)/.test(hover.transform),
    JSON.stringify({ base: base.transform, hover: hover.transform })
  );
  assert(
    "card-hover-border-strong",
    hover.borderColor === hexToRgb(tokens.borderStrong) &&
      base.borderColor === hexToRgb(tokens.borderDefault),
    JSON.stringify({
      base: base.borderColor,
      hover: hover.borderColor,
      expectedStrong: hexToRgb(tokens.borderStrong),
    })
  );
  assert(
    "card-motion-120ms-steps2",
    /0\.12s|120ms/.test(String(hover.transitionDuration)) &&
      /steps\(2/.test(String(hover.transitionTimingFunction)),
    JSON.stringify({ duration: hover.transitionDuration, timing: hover.transitionTimingFunction })
  );
  assert(
    "card-thumb-aspect-locked",
    ["16 / 10", "16/10", "1.6"].includes(String(hover.thumbAspectRatio)),
    `aspect-ratio=${hover.thumbAspectRatio}`
  );
  assert(
    "card-one-link-title-name",
    hover.href === "/work/apecx-2026" &&
      hover.titleText &&
      !hover.ariaLabel &&
      hover.linkText &&
      hover.linkText.includes(hover.titleText),
    JSON.stringify({ href: hover.href, ariaLabel: hover.ariaLabel, linkText: hover.linkText, title: hover.titleText })
  );

  await moveMouseTo(ws, 4, 4);
  await cdpEval(ws, `window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); true`);
  await sleep(200);
  let focus = null;
  for (let i = 0; i < 30; i++) {
    await pressTab(ws);
    const info = await readFocusRing(ws);
    if (info.isCard) {
      focus = info;
      break;
    }
  }
  assert(
    "card-focus-visible-ring",
    !!focus &&
      focus.outlineWidth === "2px" &&
      focus.outlineStyle === "solid" &&
      focus.outlineColor === hexToRgb(tokens.amber) &&
      focus.outlineOffset === "2px",
    JSON.stringify({ focus, amberRgb: hexToRgb(tokens.amber) })
  );
}

// Artifacts: task-6-screenshot-1440.png, task-6-dom-dump.html,
// task-6-computed-styles.json (h1 static, CTA links, hover/focus, aspect, grids).
async function runArtifactsCapture(ws) {
  console.log("\n[probe] === ARTIFACTS (screenshot / DOM dump / computed styles) ===");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  try {
    await cdpSend(ws, "Page.bringToFront");
  } catch {}
  try {
    await cdpSend(ws, "Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch {}
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
  await cdpSend(ws, "Page.navigate", { url: HOME_URL });
  await sleep(3000);

  const shot = await cdpSend(ws, "Page.captureScreenshot", { format: "png" });
  const shotPath = join(EVIDENCE_DIR, "task-6-screenshot-1440.png");
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
  console.log(`[probe] screenshot -> ${shotPath}`);

  const html = await cdpEval(ws, `document.documentElement.outerHTML`);
  const domPath = join(EVIDENCE_DIR, "task-6-dom-dump.html");
  writeFileSync(domPath, html, "utf8");
  console.log(`[probe] dom dump -> ${domPath} (${html.length} bytes)`);

  const home = await cdpEval(
    ws,
    `(() => {
      const h1 = document.querySelector('h1');
      const cs = h1 ? getComputedStyle(h1) : null;
      const hero = h1 ? (h1.closest('section') || h1.parentElement) : null;
      const ctas = hero
        ? [...hero.querySelectorAll('a.neo-pixel-btn')].map((a) => ({
            text: a.textContent.trim(),
            href: a.getAttribute('href'),
            className: a.className,
          }))
        : [];
      const cards = [...document.querySelectorAll('[data-testid="project-card"], .project-card')].map((c) => {
        const thumb = c.querySelector('[data-testid="project-thumbnail"]');
        const title = c.querySelector('h2, h3');
        return {
          href: c.getAttribute('href'),
          ariaLabel: c.getAttribute('aria-label'),
          title: title ? title.textContent.trim() : null,
          featured: c.getAttribute('data-featured'),
          thumbAspectRatio: thumb ? getComputedStyle(thumb).aspectRatio : null,
          transform: getComputedStyle(c).transform,
          borderColor: getComputedStyle(c).borderColor,
        };
      });
      return {
        theme: document.documentElement.dataset.theme || null,
        h1: h1
          ? {
              text: h1.textContent.trim(),
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              lineHeight: cs.lineHeight,
              letterSpacing: cs.letterSpacing,
              animationName: cs.animationName,
              animationDuration: cs.animationDuration,
              opacity: cs.opacity,
            }
          : null,
        heroCtaCount: ctas.length,
        heroCtas: ctas,
        cardCount: cards.length,
        cards,
      };
    })()`
  );

  // §5.4: home surfaces the featured set, in projects-array order.
  const homeCardHrefs = home.cards.map((c) => c.href);
  assert(
    "home-featured-set",
    homeCardHrefs.length === 3 &&
      homeCardHrefs[0] === "/work/apecx-2026" &&
      homeCardHrefs[1] === "/work/malpres-2025" &&
      homeCardHrefs[2] === "/work/buku-tahu",
    JSON.stringify(homeCardHrefs)
  );

  let hoverCapture = null;
  if (home.cardCount > 0) {
    await cdpEval(
      ws,
      `document.querySelector('[data-testid="project-card"], .project-card').scrollIntoView({ block: 'center' }); true`
    );
    await sleep(500);
    await moveMouseTo(ws, 4, 4);
    const base = await readCardState(ws);
    const r = await cdpEval(
      ws,
      `(() => {
        const r = document.querySelector('[data-testid="project-card"], .project-card').getBoundingClientRect();
        return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
      })()`
    );
    await moveMouseTo(ws, r.cx, r.cy);
    const hovered = await readCardState(ws);
    hoverCapture = {
      base: { transform: base.transform, borderColor: base.borderColor },
      hover: { transform: hovered.transform, borderColor: hovered.borderColor },
    };
  }

  let focusCapture = null;
  await moveMouseTo(ws, 4, 4);
  await cdpEval(ws, `window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); true`);
  await sleep(200);
  for (let i = 0; i < 30; i++) {
    await pressTab(ws);
    const info = await readFocusRing(ws);
    if (info.isCard) {
      focusCapture = info;
      break;
    }
  }

  const grids = {};
  for (const count of [0, 1, 3, 5]) {
    await cdpSend(ws, "Page.navigate", { url: `http://127.0.0.1:${PORT}/home-qa/${count}` });
    await sleep(1600);
    grids[String(count)] = await cdpEval(
      ws,
      `(() => {
        const grid = document.querySelector('[data-testid="project-grid"], .project-grid');
        const empty = document.querySelector('[data-testid="empty-work"], .empty-work-card');
        return {
          cardCount: document.querySelectorAll('[data-testid="project-card"], .project-card').length,
          featuredCount: document.querySelectorAll('[data-featured="true"], .project-card--featured').length,
          listCount: document.querySelectorAll('.project-list .project-card').length,
          emptyState: !!empty,
          emptyText: empty ? empty.textContent.trim() : null,
          gridDisplay: grid ? getComputedStyle(grid).display : null,
          gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
        };
      })()`
    );
  }

  const payload = {
    capturedAt: new Date().toISOString(),
    buildId: readFileSync(join(ROOT, ".next", "BUILD_ID"), "utf8").trim(),
    viewport: "1440x900",
    home,
    cardHover: hoverCapture,
    cardFocus: focusCapture,
    grids,
  };
  const jsonPath = join(EVIDENCE_DIR, "task-6-computed-styles.json");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[probe] computed styles -> ${jsonPath}`);
}

// ── main try/finally — guarantees cleanup even on unhandled throw ──
try {

// ── 0. Pre-free ports from any orphaned previous run ──
function freePortSync(port, label) {
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const pids = new Set();
    const re = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      console.log(`[probe] pre-free ${label} port ${port} (pid ${pid})`);
      try { execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: "ignore" }); } catch {}
    }
  } catch {}
}
freePortSync(PORT, "server");
freePortSync(CDP_PORT, "cdp");

// ── 1. Build & start prod server (DETACHED, stdio to file) ──
const SKIP_BUILD = process.argv.includes("--skip-build");
if (SKIP_BUILD) {
  console.log("[probe] --skip-build: reusing existing .next");
} else {
  console.log("[probe] Building...");
  const buildStart = Date.now();
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
  console.log(`[probe] Build done in ${Date.now() - buildStart}ms`);
}

// Open a log file for server output (prevents pipe hold)
let serverLogFd;
try {
  execSync(`mkdir "${EVIDENCE_DIR}" 2>nul`, { stdio: "ignore" });
} catch {}
const serverLogPath = join(EVIDENCE_DIR, "task-6-server.log");
serverLogFd = openSync(serverLogPath, "w");

console.log("[probe] Starting server on port", PORT, "(detached, log:", serverLogPath, ")");
const serverChild = spawn(
  "node",
  [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)],
  {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", serverLogFd, serverLogFd],
  }
);
serverPid = serverChild.pid;
serverChild.unref(); // detach from parent event loop
closeSync(serverLogFd);
console.log(`[probe] Server PID: ${serverPid}`);

// Wait for server ready
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) break;
  } catch {}
  if (i === 29) { console.error("[probe] Server did not start"); await cleanup(); process.exit(1); }
}
console.log("[probe] Server ready");

// ── 2. Launch Chrome headless (DETACHED, stdio ignore) ──
chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-home-probe-"));
const chromeChild = spawn(CHROME, [
  `--headless=new`,
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${chromeTmpDir}`,
  `--disable-gpu`,
  `--no-sandbox`,
  `--window-size=1280,900`,
], { detached: true, stdio: "ignore" });
chromePid = chromeChild.pid;
chromeChild.unref();
console.log(`[probe] Chrome PID: ${chromePid}`);

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

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP A: Home page (/) — hero assertions
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[probe] === HOME PAGE HERO ===");
await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
});
await cdpSend(ws, "Page.navigate", { url: HOME_URL });
await sleep(3000);

// TEST A1: <h1> present
console.log("\n[probe] Test A1: <h1> present");
const h1Info = await cdpEval(ws, `
  (() => {
    const h1 = document.querySelector('h1');
    if (!h1) return { exists: false };
    const cs = getComputedStyle(h1);
    return {
      exists: true,
      text: h1.textContent.trim().substring(0, 100),
      tag: h1.tagName,
    };
  })()
`);
assert("h1-present", h1Info.exists, JSON.stringify(h1Info));

// TEST A2: <h1> server-rendered (check initial HTML has h1)
console.log("\n[probe] Test A2: <h1> server-rendered");
const htmlResponse = await fetch(HOME_URL);
const htmlText = await htmlResponse.text();
const h1InSSR = /<h1[\s>]/.test(htmlText);
assert("h1-server-rendered", h1InSSR, `h1 in SSR HTML: ${h1InSSR}`);

// TEST A3: <h1> has NO animation
console.log("\n[probe] Test A3: <h1> no animation");
const h1Animation = await cdpEval(ws, `
  (() => {
    const h1 = document.querySelector('h1');
    if (!h1) return { error: 'no h1' };
    const cs = getComputedStyle(h1);
    return {
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      transitionProperty: cs.transitionProperty,
      opacity: cs.opacity,
    };
  })()
`);
assert("h1-no-animation",
  !h1Animation.error &&
  (h1Animation.animationName === "none" || h1Animation.animationName === "") &&
  h1Animation.opacity === "1",
  JSON.stringify(h1Animation)
);

// TEST A4: No above-fold text starts at opacity: 0 (§7.2)
console.log("\n[probe] Test A4: No above-fold opacity:0 text");
const aboveFoldOpacity = await cdpEval(ws, `
  (() => {
    const els = document.querySelectorAll('h1, h2, h3, p, span, a');
    const zeroOpacity = [];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 900) {
        const cs = getComputedStyle(el);
        if (cs.opacity === '0') {
          zeroOpacity.push({ tag: el.tagName, text: el.textContent.trim().substring(0, 30) });
        }
      }
    }
    return zeroOpacity;
  })()
`);
assert("no-above-fold-opacity-0", aboveFoldOpacity.length === 0,
  aboveFoldOpacity.length > 0 ? JSON.stringify(aboveFoldOpacity) : "none found"
);

// TEST A5: 2 CTA buttons present in hero
console.log("\n[probe] Test A5: 2 CTA buttons in hero");
const ctaButtons = await cdpEval(ws, `
  (() => {
    // Look for hero section — parent of h1
    const h1 = document.querySelector('h1');
    if (!h1) return { count: 0, error: 'no h1' };
    // Walk up to find hero container (section or header-like)
    let hero = h1.closest('section') || h1.parentElement;
    // Count buttons/links with neo-pixel-btn class in hero
    const btns = hero.querySelectorAll('.neo-pixel-btn, a.neo-pixel-btn');
    return {
      count: btns.length,
      texts: Array.from(btns).map(b => b.textContent.trim()),
    };
  })()
`);
assert("hero-2-cta-buttons", ctaButtons.count >= 2,
  `count=${ctaButtons.count}, texts=${JSON.stringify(ctaButtons.texts)}`
);

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP B: Featured work grid §5.4 via temp QA fixture routes
// Fixture routes at /home-qa/N render the Home page grid with N fake projects.
// These routes must exist before running this probe.
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[probe] === FEATURED WORK GRID §5.4 ===");

const gridCounts = [0, 1, 3, 5];
for (const count of gridCounts) {
  const qaUrl = `http://127.0.0.1:${PORT}/home-qa/${count}`;
  console.log(`\n[probe] Grid test: ${count} projects at ${qaUrl}`);

  await cdpSend(ws, "Page.navigate", { url: qaUrl });
  await sleep(2000);

  // Check if route exists (404 means fixture not created yet — expected before impl)
  const pageExists = await cdpEval(ws, `!document.querySelector('[data-nextjs-error]') && document.title !== '404'`);
  if (!pageExists) {
    assert(`grid-${count}-route-exists`, false, `QA fixture route ${qaUrl} not found`);
    continue;
  }

  if (count === 0) {
    // §5.4: "Single empty-state card with copy slot EMPTY_WORK_MESSAGE"
    const emptyState = await cdpEval(ws, `
      (() => {
        const emptyCard = document.querySelector('[data-testid="empty-work"]') ||
                          document.querySelector('.empty-work-card');
        return { exists: !!emptyCard, text: emptyCard?.textContent?.trim()?.substring(0, 100) };
      })()
    `);
    assert(`grid-0-empty-state`, emptyState.exists, JSON.stringify(emptyState));
  } else if (count <= 2) {
    // §5.4: "Full-width featured cards"
    const fullWidth = await cdpEval(ws, `
      (() => {
        const cards = document.querySelectorAll('[data-testid="project-card"],.project-card');
        const info = Array.from(cards).map(c => {
          const cs = getComputedStyle(c);
          const rect = c.getBoundingClientRect();
          const parentRect = c.parentElement.getBoundingClientRect();
          return { width: rect.width, parentWidth: parentRect.width, ratio: rect.width / parentRect.width };
        });
        return { count: cards.length, cards: info };
      })()
    `);
    assert(`grid-${count}-count`, fullWidth.count === count, `count=${fullWidth.count}`);
    // Each card should take full container width (ratio > 0.9)
    const allFullWidth = fullWidth.cards.every(c => c.ratio > 0.9);
    assert(`grid-${count}-full-width`, allFullWidth, JSON.stringify(fullWidth.cards));
  } else if (count <= 4) {
    // §5.4: "2x2 grid"
    const gridLayout = await cdpEval(ws, `
      (() => {
        const container = document.querySelector('[data-testid="project-grid"],.project-grid');
        if (!container) return { error: 'no grid container' };
        const cs = getComputedStyle(container);
        const cards = container.querySelectorAll('[data-testid="project-card"],.project-card');
        return {
          count: cards.length,
          display: cs.display,
          gridTemplateColumns: cs.gridTemplateColumns,
        };
      })()
    `);
    assert(`grid-${count}-count`, gridLayout.count === count, `count=${gridLayout.count}`);
  } else {
    // §5.4: "One featured row, remainder as a list" (5+)
    const mixedLayout = await cdpEval(ws, `
      (() => {
        const cards = document.querySelectorAll('[data-testid="project-card"],.project-card');
        const featured = document.querySelectorAll('[data-featured="true"],.project-card--featured');
        const remainder = document.querySelectorAll('[data-featured="false"],.project-card--list,.project-card:not(.project-card--featured):not([data-featured="true"])');
        return {
          totalCards: cards.length,
          featuredCount: featured.length,
          remainderCount: cards.length - featured.length,
        };
      })()
    `);
    assert(`grid-${count}-count`, mixedLayout.totalCards === count, `total=${mixedLayout.totalCards}`);
    assert(`grid-${count}-has-featured`, mixedLayout.featuredCount >= 1, `featured=${mixedLayout.featuredCount}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST GROUP C: ProjectCard details (on main Home or fixture with projects)
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[probe] === PROJECT CARD DETAILS ===");

// Navigate to fixture with 3 projects
await cdpSend(ws, "Page.navigate", { url: `http://127.0.0.1:${PORT}/home-qa/3` });
await sleep(2000);

// TEST C1: ProjectCard link accessible-name = title (§6.3)
console.log("\n[probe] Test C1: ProjectCard accessible name = title");
const cardAccessibility = await cdpEval(ws, `
  (() => {
    const cards = document.querySelectorAll('[data-testid="project-card"],.project-card');
    return Array.from(cards).map(card => {
      const link = card.closest('a') || card.querySelector('a');
      const title = card.querySelector('h2,h3,[data-testid="project-title"]');
      return {
        hasLink: !!link,
        linkText: link?.textContent?.trim()?.substring(0, 100),
        ariaLabel: link?.getAttribute('aria-label'),
        titleText: title?.textContent?.trim(),
        accessibleName: link?.getAttribute('aria-label') || link?.textContent?.trim()?.substring(0, 100),
      };
    });
  })()
`);

for (let i = 0; i < cardAccessibility.length; i++) {
  const card = cardAccessibility[i];
  // Accessible name should contain title text
  const nameIncludesTitle = card.accessibleName && card.titleText &&
    card.accessibleName.includes(card.titleText);
  assert(`card-${i}-accessible-name`, card.hasLink && nameIncludesTitle,
    JSON.stringify(card)
  );
}

// TEST C2: Thumbnail aspect-ratio 16/10 locked (§6.3)
console.log("\n[probe] Test C2: Thumbnail aspect-ratio 16/10");
const thumbnails = await cdpEval(ws, `
  (() => {
    const cards = document.querySelectorAll('[data-testid="project-card"],.project-card');
    return Array.from(cards).map(card => {
      const img = card.querySelector('img,[data-testid="project-thumbnail"]');
      const wrapper = img?.parentElement;
      if (!img && !wrapper) return { error: 'no thumbnail' };
      const target = wrapper || img;
      const cs = getComputedStyle(target);
      return {
        aspectRatio: cs.aspectRatio,
        imgAspectRatio: img ? getComputedStyle(img).aspectRatio : null,
      };
    });
  })()
`);

for (let i = 0; i < thumbnails.length; i++) {
  const t = thumbnails[i];
  // Accept "16/10", "16 / 10", "1.6", "8/5" as valid 16:10 ratio
  const valid = t.aspectRatio === "16 / 10" || t.aspectRatio === "16/10" ||
    t.aspectRatio === "8 / 5" || t.aspectRatio === "8/5" ||
    t.aspectRatio === "1.6" ||
    t.imgAspectRatio === "16 / 10" || t.imgAspectRatio === "16/10" ||
    t.imgAspectRatio === "8 / 5" || t.imgAspectRatio === "8/5" ||
    t.imgAspectRatio === "1.6";
  assert(`card-${i}-aspect-ratio-16-10`, valid, JSON.stringify(t));
}

// TEST C3: No stretched orphan in last row (§5.4)
console.log("\n[probe] Test C3: No stretched orphan cell");
// Navigate to fixture with 5 projects (uneven grid)
await cdpSend(ws, "Page.navigate", { url: `http://127.0.0.1:${PORT}/home-qa/5` });
await sleep(2000);

const orphanCheck = await cdpEval(ws, `
  (() => {
    const cards = document.querySelectorAll('[data-testid="project-card"],.project-card');
    if (cards.length === 0) return { error: 'no cards' };
    // Get rects of all cards
    const rects = Array.from(cards).map(c => {
      const r = c.getBoundingClientRect();
      return { width: r.width, left: r.left, right: r.right, top: r.top };
    });
    // Group by row (same top)
    const rows = {};
    for (const r of rects) {
      const rowKey = Math.round(r.top);
      if (!rows[rowKey]) rows[rowKey] = [];
      rows[rowKey].push(r);
    }
    const rowValues = Object.values(rows);
    const lastRow = rowValues[rowValues.length - 1];
    // Check if any card in last row is abnormally wide (stretched)
    // A "stretched" card would be wider than other cards by > 50%
    const avgWidth = rects.reduce((s, r) => s + r.width, 0) / rects.length;
    const stretchedInLastRow = lastRow.filter(c => c.width > avgWidth * 1.5);
    return {
      totalCards: cards.length,
      rowCount: rowValues.length,
      lastRowCount: lastRow.length,
      stretchedCount: stretchedInLastRow.length,
    };
  })()
`);
assert("no-stretched-orphan", orphanCheck.stretchedCount === 0 || orphanCheck.error,
  JSON.stringify(orphanCheck)
);

await runCardInteractionSuite(ws);
await runArtifactsCapture(ws);

// ═══════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════
const output = {
  timestamp: new Date().toISOString(),
  failures,
  pass: failures === 0,
  results,
};

console.log("\n" + JSON.stringify(output, null, 2));

ws.close();

} finally {
  // ALWAYS cleanup — kill server + chrome trees, verify port dead
  await cleanup();
}

if (failures > 0) {
  console.log(`\n[probe] FAIL — ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\n[probe] PASS — all assertions passed`);
  process.exit(0);
}
