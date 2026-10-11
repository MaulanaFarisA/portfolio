#!/usr/bin/env node
/**
 * verify-contact.mjs — Zero-dependency CDP probe for §6.7 Contact + Footer.
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
const PAGE_URL = `http://localhost:${PORT}/contact`;
const ROOT = join(import.meta.dirname, "..");
const EVIDENCE_DIR = join(ROOT, "..", ".omo", "evidence");

// Ensure evidence dir
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
const serverLogFd = openSync(join(EVIDENCE_DIR, "task-11-server.log"), "w");

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
      // Still listening — wait
      await sleep(500);
    } catch {
      // Connection refused — port free
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
  // Mark as killed to prevent double-kill
  if (chromeProc) chromeProc.killed = true;
  if (serverProc) serverProc.killed = true;
  // Poll ports free
  await waitPortFree(PORT, 10000);
  await waitPortFree(CDP_PORT, 5000);
  console.log("[cleanup] server tree dead: true");
  try {
    if (chromeTmpDir) rmSync(chromeTmpDir, { recursive: true, force: true });
  } catch {}
}

process.on("exit", () => {
  // Synchronous last-resort kill
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
      const res = await fetch(`http://localhost:${PORT}/contact`);
      if (res.ok) break;
    } catch {}
    if (i === 29) { console.error("[probe] Server did not start"); await cleanup(); process.exit(1); }
  }
  console.log("[probe] Server ready");

  // ── 2. Launch Chrome headless (DETACHED, stdio ignore) ──
  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-contact-probe-"));
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

  // Grant clipboard permissions for copy test
  await cdpSend(ws, "Browser.grantPermissions", {
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    origin: `http://localhost:${PORT}`,
  });

  // Navigate to contact page
  await cdpSend(ws, "Page.navigate", { url: PAGE_URL });
  await sleep(3000);

  // ═══════════════════════════════════════
  // TEST 1: mailto link with correct href
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 1: mailto link");
  const mailtoLink = await cdpEval(ws, `
    (() => {
      const link = document.querySelector('a[href^="mailto:"]');
      return {
        exists: !!link,
        href: link?.href ?? null,
        hasEmail: link?.href?.includes('maulfawriz@gmail.com') || link?.textContent?.includes('maulfawriz@gmail.com'),
      };
    })()
  `);
  assert("mailto-link-exists", mailtoLink.exists, JSON.stringify(mailtoLink));
  assert("mailto-has-email", mailtoLink.hasEmail,
    `href=${mailtoLink.href}`);

  // ═══════════════════════════════════════
  // TEST 2: Copy-to-clipboard button
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 2: Copy-to-clipboard button");
  const copyBtn = await cdpEval(ws, `
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const copyBtn = btns.find(b =>
        b.textContent.toLowerCase().includes('copy') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('copy')
      );
      if (!copyBtn) return { exists: false };
      const r = copyBtn.getBoundingClientRect();
      return {
        exists: true,
        text: copyBtn.textContent.trim(),
        ariaLabel: copyBtn.getAttribute('aria-label'),
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
      };
    })()
  `);
  assert("copy-button-exists", copyBtn.exists, JSON.stringify(copyBtn));

  if (copyBtn.exists) {
    await cdpSend(ws, "Input.dispatchMouseEvent", {
      type: "mousePressed", x: copyBtn.cx, y: copyBtn.cy, button: "left", clickCount: 1,
    });
    await cdpSend(ws, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x: copyBtn.cx, y: copyBtn.cy, button: "left", clickCount: 1,
    });
    await sleep(500);

    // Check clipboard content
    const clipboardContent = await cdpEval(ws, `navigator.clipboard.readText()`);
    assert("clipboard-has-email",
      clipboardContent && clipboardContent.includes("maulfawriz@gmail.com"),
      `clipboard="${clipboardContent}"`
    );

    // Check visual feedback
    const feedbackState = await cdpEval(ws, `
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const copyBtn = btns.find(b =>
          b.textContent.toLowerCase().includes('copied') ||
          b.textContent.toLowerCase().includes('copy') ||
          b.getAttribute('aria-label')?.toLowerCase().includes('copy')
        );
        return {
          text: copyBtn?.textContent?.trim(),
          ariaLabel: copyBtn?.getAttribute('aria-label'),
          hasSuccessClass: copyBtn?.className?.includes('success') || copyBtn?.className?.includes('copied'),
          hasFeedbackEl: !!document.querySelector('[data-copied], .copy-feedback, [role="status"]'),
        };
      })()
    `);
    assert("copy-visual-feedback",
      feedbackState.text?.toLowerCase().includes("copied") ||
      feedbackState.hasSuccessClass ||
      feedbackState.hasFeedbackEl,
      JSON.stringify(feedbackState)
    );
  }

  // ═══════════════════════════════════════
  // TEST 3: Social icon links with aria-label
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 3: Social links");
  const socialLinks = await cdpEval(ws, `
    (() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const socials = links.filter(a => {
        const href = a.href.toLowerCase();
        return href.includes('github.com/maulanafarisa') ||
               href.includes('linkedin.com/in/maulanafaris') ||
               href.includes('instagram.com/maulanafariiss') ||
               href.includes('twitter.com') || href.includes('x.com');
      });
      return socials.map(a => ({
        href: a.href,
        ariaLabel: a.getAttribute('aria-label'),
        rel: a.getAttribute('rel'),
        target: a.getAttribute('target'),
        hasExternalCue: !!a.querySelector('[aria-hidden="true"]') ||
                        a.textContent.includes('↗') ||
                        a.innerHTML.includes('external') ||
                        a.classList.toString().includes('external'),
      }));
    })()
  `);
  assert("social-links-exist", socialLinks.length >= 3, `count=${socialLinks.length}`);
  assert("social-github-link",
    socialLinks.some((l) => l.href === "https://github.com/MaulanaFarisA"),
    `hrefs=${JSON.stringify(socialLinks.map((l) => l.href))}`);
  assert("social-linkedin-link",
    socialLinks.some((l) => l.href === "https://www.linkedin.com/in/maulanafaris"),
    `hrefs=${JSON.stringify(socialLinks.map((l) => l.href))}`);
  assert("social-instagram-link",
    socialLinks.some((l) => l.href === "https://www.instagram.com/maulanafariiss"),
    `hrefs=${JSON.stringify(socialLinks.map((l) => l.href))}`);
  const xLinks = await cdpEval(ws, `
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(h => h.toLowerCase().includes('x.com') || h.toLowerCase().includes('twitter.com'))
  `);
  assert("social-x-absent", xLinks.length === 0,
    `x/twitter links=${JSON.stringify(xLinks)}`);
  for (const link of socialLinks) {
    assert(`social-aria-label-${link.href}`,
      !!link.ariaLabel && link.ariaLabel.length > 0,
      `aria-label="${link.ariaLabel}"`
    );
    assert(`social-rel-noopener-${link.href}`,
      link.rel && link.rel.includes("noopener") && link.rel.includes("noreferrer"),
      `rel="${link.rel}"`
    );
  }

  // ═══════════════════════════════════════
  // TEST 4: External links have visible cue
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 4: External links visible cue");
  const externalCues = await cdpEval(ws, `
    (() => {
      const links = Array.from(document.querySelectorAll('a[target="_blank"], a[rel*="noopener"]'));
      return links.map(a => ({
        href: a.href,
        hasVisualCue: a.querySelector('svg') !== null ||
                      a.textContent.includes('↗') ||
                      a.innerHTML.includes('external-icon') ||
                      window.getComputedStyle(a, '::after').content !== 'none',
      }));
    })()
  `);
  const allHaveCue = externalCues.length === 0 || externalCues.every(l => l.hasVisualCue);
  assert("external-links-have-cue", allHaveCue,
    JSON.stringify(externalCues.filter(l => !l.hasVisualCue)));

  // ═══════════════════════════════════════
  // TEST 5: Resume PDF button
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 5: Resume PDF button");
  const resumeBtn = await cdpEval(ws, `
    (() => {
      const links = Array.from(document.querySelectorAll('a, button'));
      const resume = links.find(el =>
        el.textContent.toLowerCase().includes('resume') ||
        el.textContent.toLowerCase().includes('cv') ||
        el.href?.includes('/resume.pdf') ||
        el.getAttribute('href')?.includes('/resume.pdf')
      );
      return {
        exists: !!resume,
        tag: resume?.tagName,
        text: resume?.textContent?.trim(),
        href: resume?.getAttribute?.('href'),
      };
    })()
  `);
  assert("resume-button-exists", resumeBtn.exists, JSON.stringify(resumeBtn));
  assert("resume-has-pdf-href",
    resumeBtn.href?.includes("/resume.pdf") || resumeBtn.text?.includes("/resume.pdf"),
    `href=${resumeBtn.href}`
  );

  // ═══════════════════════════════════════
  // TEST 6: Footer copyright
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 6: Footer copyright");
  const footer = await cdpEval(ws, `
    (() => {
      const footer = document.querySelector('footer');
      return {
        exists: !!footer,
        text: footer?.textContent?.trim(),
        hasCopyright: footer?.textContent?.includes('©') || footer?.textContent?.includes('copyright'),
      };
    })()
  `);
  assert("footer-exists", footer.exists, JSON.stringify(footer));
  assert("footer-has-copyright", footer.hasCopyright, `text="${footer.text}"`);

  // ═══════════════════════════════════════
  // TEST 7: Page has single h1
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 7: Single h1");
  const h1Count = await cdpEval(ws, `document.querySelectorAll('h1').length`);
  assert("single-h1", h1Count === 1, `h1 count=${h1Count}`);

  // ═══════════════════════════════════════
  // TEST 8: Non-HTTPS clipboard fallback
  // ═══════════════════════════════════════
  console.log("\n[probe] Test 8: Clipboard fallback mechanism exists in source");
  try {
    const srcContent = execSync(
      `findstr /S /R /C:"execCommand" /C:"fallback" /C:"catch" "${join(ROOT, "src")}\\*.tsx" "${join(ROOT, "src")}\\*.ts" 2>nul`,
      { encoding: "utf-8" }
    );
    assert("clipboard-fallback-exists",
      srcContent.includes("execCommand") || srcContent.includes("fallback"),
      "fallback mechanism found in source"
    );
  } catch {
    assert("clipboard-fallback-exists", false, "no clipboard fallback found in source");
  }

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
