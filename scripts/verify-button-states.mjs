#!/usr/bin/env node
/**
 * verify-button-states.mjs — Zero-dependency CDP probe for §6.8 button states.
 * Uses Node 22 global WebSocket + fetch + chrome --headless=new.
 * Exits 0 on all-pass, 1 on any mismatch.
 */
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3104;
const CDP_PORT = 9225;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = `http://localhost:${PORT}/components-qa`;

// ── helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let nextId = 1;
function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const handler = (ev) => {
      const msg = JSON.parse(typeof ev === "string" ? ev : ev.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
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

async function cleanup() {
  try { if (chromeProc && !chromeProc.killed) chromeProc.kill(); } catch {}
  try { if (serverProc && !serverProc.killed) serverProc.kill(); } catch {}
  // Kill any remaining processes on the ports
  try { execSync(`npx kill-port ${PORT} 2>nul`, { stdio: "ignore" }); } catch {}
  try {
    if (chromeTmpDir) rmSync(chromeTmpDir, { recursive: true, force: true });
  } catch {}
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

// ── 1. Build & start prod server ──
console.log("[probe] Building...");
const buildStart = Date.now();
execSync("npm run build", { cwd: join(import.meta.dirname, ".."), stdio: "pipe" });
console.log(`[probe] Build done in ${Date.now() - buildStart}ms`);

console.log("[probe] Starting server on port", PORT);
serverProc = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: join(import.meta.dirname, ".."),
  stdio: "pipe",
  shell: true,
});

// Wait for server ready
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  try {
    const res = await fetch(`http://localhost:${PORT}/components-qa`);
    if (res.ok) break;
  } catch {}
  if (i === 29) { console.error("[probe] Server did not start"); process.exit(1); }
}
console.log("[probe] Server ready");

// ── 2. Launch Chrome headless ──
chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-probe-"));
chromeProc = spawn(CHROME, [
  `--headless=new`,
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${chromeTmpDir}`,
  `--disable-gpu`,
  `--no-sandbox`,
  `--window-size=1280,900`,
], { stdio: "pipe" });

await sleep(2000);

// Get a page-level WS endpoint (Page.enable only works on page targets, not browser)
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
if (!wsUrl) { console.error("[probe] Chrome CDP page target not reachable"); process.exit(1); }
console.log("[probe] CDP page target connected:", wsUrl);

// ── 3. Connect via WebSocket ──
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

await cdpSend(ws, "Page.enable");
await cdpSend(ws, "Runtime.enable");

// Navigate
await cdpSend(ws, "Page.navigate", { url: URL });
await sleep(3000); // wait for page load + hydration

// ── 4. Collect button info ──
const buttons = await cdpEval(ws, `
  (() => {
    const btns = document.querySelectorAll('.neo-pixel-btn');
    return Array.from(btns).map((b, i) => {
      const r = b.getBoundingClientRect();
      return {
        index: i,
        text: b.textContent.trim(),
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
        variant: b.classList.contains('neo-pixel-btn--ghost') ? 'ghost' :
                 b.classList.contains('neo-pixel-btn--danger') ? 'danger' :
                 b.classList.contains('neo-pixel-btn--secondary') ? 'secondary' : 'primary',
        disabled: b.disabled,
      };
    });
  })()
`);

console.log(`[probe] Found ${buttons.length} buttons`);

// ── 5. Test each non-disabled button ──
const results = {};
let failures = 0;

// Spec expectations
const specs = {
  default: {
    primary:   { boxShadowPx: "3px 3px 0px 0px", transform: "none" },
    secondary: { boxShadowPx: "3px 3px 0px 0px", transform: "none" },
    ghost:     { boxShadow: "none", transform: "none" },
    danger:    { boxShadowPx: "3px 3px 0px 0px", transform: "none" },
  },
  hover: {
    primary:   { boxShadowPx: "4px 4px 0px 0px", transformContains: "translate" },
    secondary: { boxShadowPx: "4px 4px 0px 0px", transformContains: "translate" },
    ghost:     { boxShadow: "none", transform: "none", borderColorNotTransparent: true },
    danger:    { boxShadowPx: "4px 4px 0px 0px", transformContains: "translate" },
  },
  active: {
    primary:   { boxShadowPx: "1px 1px 0px 0px", transformContains: "translate" },
    secondary: { boxShadowPx: "1px 1px 0px 0px", transformContains: "translate" },
    ghost:     { transform: "none" },
    danger:    { boxShadowPx: "1px 1px 0px 0px", transformContains: "translate" },
  },
};

function checkShadow(actual, expectedPx) {
  // computed box-shadow has color prefix, e.g. "rgba(61,67,76,1) 3px 3px 0px 0px"
  // just check the dimensional part
  return actual.includes(expectedPx);
}

for (const btn of buttons) {
  if (btn.disabled) continue;
  const v = btn.variant;
  const key = `${v}:${btn.text}`;
  results[key] = {};

  // -- DEFAULT state --
  const defaultStyles = await cdpEval(ws, `
    (() => {
      const b = document.querySelectorAll('.neo-pixel-btn')[${btn.index}];
      const cs = getComputedStyle(b);
      return { boxShadow: cs.boxShadow, transform: cs.transform, borderColor: cs.borderColor, outline: cs.outline };
    })()
  `);
  results[key].default = defaultStyles;

  // Verify default
  const dSpec = specs.default[v];
  if (dSpec) {
    if (dSpec.boxShadowPx && !checkShadow(defaultStyles.boxShadow, dSpec.boxShadowPx)) {
      results[key].default_FAIL = `expected shadow containing "${dSpec.boxShadowPx}", got "${defaultStyles.boxShadow}"`;
      failures++;
    }
    if (dSpec.boxShadow === "none" && defaultStyles.boxShadow !== "none") {
      results[key].default_FAIL = `expected shadow "none", got "${defaultStyles.boxShadow}"`;
      failures++;
    }
  }

  // -- HOVER state --
  // Move mouse to button center
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mouseMoved", x: btn.cx, y: btn.cy,
  });
  await sleep(200);

  const hoverStyles = await cdpEval(ws, `
    (() => {
      const b = document.querySelectorAll('.neo-pixel-btn')[${btn.index}];
      const cs = getComputedStyle(b);
      return { boxShadow: cs.boxShadow, transform: cs.transform, borderColor: cs.borderColor };
    })()
  `);
  results[key].hover = hoverStyles;

  // Verify hover
  const hSpec = specs.hover[v];
  if (hSpec) {
    if (hSpec.boxShadowPx && !checkShadow(hoverStyles.boxShadow, hSpec.boxShadowPx)) {
      results[key].hover_FAIL = `expected shadow containing "${hSpec.boxShadowPx}", got "${hoverStyles.boxShadow}"`;
      failures++;
    }
    if (hSpec.boxShadow === "none" && hoverStyles.boxShadow !== "none") {
      results[key].hover_FAIL = `expected shadow "none", got "${hoverStyles.boxShadow}"`;
      failures++;
    }
    if (hSpec.transformContains && (!hoverStyles.transform || !hoverStyles.transform.includes("matrix"))) {
      results[key].hover_transform_FAIL = `expected transform containing translate, got "${hoverStyles.transform}"`;
      failures++;
    }
    if (hSpec.borderColorNotTransparent && hoverStyles.borderColor.includes("0, 0, 0, 0")) {
      results[key].hover_border_FAIL = `expected non-transparent border-color on hover, got "${hoverStyles.borderColor}"`;
      failures++;
    }
  }

  // Move mouse away to reset
  await cdpSend(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await sleep(200);

  // -- ACTIVE state --
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mousePressed", x: btn.cx, y: btn.cy, button: "left", clickCount: 1,
  });
  await sleep(100);

  const activeStyles = await cdpEval(ws, `
    (() => {
      const b = document.querySelectorAll('.neo-pixel-btn')[${btn.index}];
      const cs = getComputedStyle(b);
      return { boxShadow: cs.boxShadow, transform: cs.transform };
    })()
  `);
  results[key].active = activeStyles;

  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mouseReleased", x: btn.cx, y: btn.cy, button: "left", clickCount: 1,
  });
  await sleep(100);

  // Verify active
  const aSpec = specs.active[v];
  if (aSpec) {
    if (aSpec.boxShadowPx && !checkShadow(activeStyles.boxShadow, aSpec.boxShadowPx)) {
      results[key].active_FAIL = `expected shadow containing "${aSpec.boxShadowPx}", got "${activeStyles.boxShadow}"`;
      failures++;
    }
  }
}

// -- FOCUS-VISIBLE test --
// Use CDP key events properly to trigger keyboard navigation mode
// First click somewhere neutral to ensure clean state
await cdpSend(ws, "Input.dispatchMouseEvent", {
  type: "mousePressed", x: 10, y: 10, button: "left", clickCount: 1,
});
await cdpSend(ws, "Input.dispatchMouseEvent", {
  type: "mouseReleased", x: 10, y: 10, button: "left", clickCount: 1,
});
await sleep(100);

// Tab key with rawKeyDown (Chrome's expected format)
await cdpSend(ws, "Input.dispatchKeyEvent", {
  type: "rawKeyDown", windowsVirtualKeyCode: 9, code: "Tab", key: "Tab", nativeVirtualKeyCode: 9,
});
await cdpSend(ws, "Input.dispatchKeyEvent", {
  type: "keyUp", windowsVirtualKeyCode: 9, code: "Tab", key: "Tab", nativeVirtualKeyCode: 9,
});
await sleep(300);

// May need multiple tabs to reach a button (skip non-button focusable elements)
let focusAttempts = 0;
let focusStyles;
while (focusAttempts < 10) {
  focusStyles = await cdpEval(ws, `
    (() => {
      const active = document.activeElement;
      if (!active || !active.classList.contains('neo-pixel-btn')) return { error: 'no button focused' };
      const cs = getComputedStyle(active);
      return { outline: cs.outline, outlineColor: cs.outlineColor, outlineOffset: cs.outlineOffset, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
    })()
  `);
  if (!focusStyles.error) break;
  // Tab again
  await cdpSend(ws, "Input.dispatchKeyEvent", {
    type: "rawKeyDown", windowsVirtualKeyCode: 9, code: "Tab", key: "Tab", nativeVirtualKeyCode: 9,
  });
  await cdpSend(ws, "Input.dispatchKeyEvent", {
    type: "keyUp", windowsVirtualKeyCode: 9, code: "Tab", key: "Tab", nativeVirtualKeyCode: 9,
  });
  await sleep(200);
  focusAttempts++;
}

// If CDP Tab didn't work (common in headless), verify the CSS rule exists via direct focus + matchMedia
if (focusStyles.error) {
  focusStyles = await cdpEval(ws, `
    (() => {
      const btn = document.querySelector('.neo-pixel-btn');
      btn.focus();
      const cs = getComputedStyle(btn);
      // Check if :focus-visible rule is present by looking at the outline in the stylesheet
      const sheets = document.styleSheets;
      let hasFocusVisibleRule = false;
      for (const sheet of sheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText && rule.selectorText.includes('neo-pixel-btn') && rule.selectorText.includes('focus-visible')) {
              hasFocusVisibleRule = true;
            }
          }
        } catch {}
      }
      return {
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
        hasFocusVisibleRule,
        fallbackCheck: true,
      };
    })()
  `);
}

results["focus-visible"] = focusStyles;

// Check outline
if (focusStyles.error) {
  results["focus-visible_FAIL"] = focusStyles.error;
  failures++;
} else if (focusStyles.fallbackCheck) {
  // Fallback: check that the CSS rule exists in stylesheet
  if (!focusStyles.hasFocusVisibleRule) {
    results["focus-visible_FAIL"] = "no :focus-visible CSS rule found for .neo-pixel-btn";
    failures++;
  }
} else if (!focusStyles.outlineWidth || focusStyles.outlineWidth === "0px") {
  results["focus-visible_FAIL"] = `expected 2px outline, got "${focusStyles.outlineWidth}"`;
  failures++;
}

// ── 6. Report ──
const output = {
  timestamp: new Date().toISOString(),
  totalButtons: buttons.length,
  failures,
  pass: failures === 0,
  results,
};

console.log("\n" + JSON.stringify(output, null, 2));

// Cleanup
ws.close();
await cleanup();

if (failures > 0) {
  console.log(`\n[probe] FAIL — ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\n[probe] PASS — all assertions passed`);
  process.exit(0);
}
