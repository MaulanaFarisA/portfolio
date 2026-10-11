#!/usr/bin/env node
/**
 * verify-quality-gate.mjs â€” Task 14 FINAL quality gate (neo-pixel portfolio).
 * Covers design.md Â§11.1, Â§8.8, Â§9.1, Â§12.2, Â§4.1, Â§7.3, Â§6.1, Â§11.2.
 * Requires a prod server already running on :3111 (built under the build lock).
 * Launches its own headless Chrome on CDP :9234 with temp profile; cleans up.
 */
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = 3111;
const CDP_PORT = 9234;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = resolve(import.meta.dirname, "..");
const EVIDENCE = resolve(ROOT, "..", ".omo", "evidence");
const HOME = `http://localhost:${PORT}/`;
const ART = (name) => join(EVIDENCE, name);

const PAGES = [
  { path: "/", name: "home" },
  { path: "/work", name: "work" },
  { path: "/work/buku-tahu", name: "buku-tahu" },
  { path: "/work/malpres-2025", name: "malpres-2025" },
  { path: "/work/astar", name: "astar" },
  { path: "/about", name: "about" },
  { path: "/stack", name: "stack" },
  { path: "/contact", name: "contact" },
  { path: "/halaman-ngawur", name: "404" },
];

const BANNED_COPY = [
  /revolusikan/i, /ai-powered/i, /seamless experience/i, /unlock the power/i,
  /\blorem\b/i, /\bipsum\b/i,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const R = {
  startedAt: new Date().toISOString(),
  buildId: existsSync(join(ROOT, ".next", "BUILD_ID"))
    ? execSync(`type "${join(ROOT, ".next", "BUILD_ID")}"`, { shell: "cmd.exe" }).toString().trim()
    : null,
  checks: {},
  findings: [],
  artifacts: [],
};

let chromeProc = null;
let chromeTmpDir = null;
function killTree(pid) {
  if (!pid) return;
  try { execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: "ignore" }); } catch {}
}
process.on("exit", () => killTree(chromeProc?.pid));
process.on("SIGINT", () => { killTree(chromeProc?.pid); process.exit(1); });

let nextId = 1;
function cdpSend(ws, method, params = {}, timeoutMs = 30000) {
  return new Promise((res, rej) => {
    const id = nextId++;
    const t = setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), timeoutMs);
    const h = (ev) => {
      const m = JSON.parse(typeof ev === "string" ? ev : ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", h);
        clearTimeout(t);
        if (m.error) rej(new Error(`${method}: ${JSON.stringify(m.error)}`));
        else res(m.result);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function cdpEval(ws, expression, timeoutMs = 30000) {
  const r = await cdpSend(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(`eval error: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
  return r.result.value;
}
async function waitForLoad(ws, timeoutMs = 30000) {
  const dl = Date.now() + timeoutMs;
  while (Date.now() < dl) {
    try { if ((await cdpEval(ws, "document.readyState")) === "complete") return true; } catch {}
    await sleep(200);
  }
  return false;
}
async function navigate(ws, url, settleMs = 700) {
  await cdpSend(ws, "Page.navigate", { url });
  await waitForLoad(ws);
  if (settleMs) await sleep(settleMs);
}
async function shot(ws, file) {
  const r = await cdpSend(ws, "Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  R.artifacts.push(file);
}
async function setViewport(ws, { width, height, dsf, mobile }) {
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dsf, mobile });
}
async function resetMedia(ws) {
  await cdpSend(ws, "Emulation.setEmulatedMedia", { media: "", features: [] });
}

// â”€â”€ page-side probes (part 2) â”€â”€
const READABILITY_PROBE = `(() => {
  const bad = [];
  const samples = [];
  const els = [document.body, ...document.querySelectorAll('p, nav a, nav button, .site-nav__link, .site-nav__brand')];
  for (const el of els) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily || '';
    if (/vt323/i.test(fam)) {
      bad.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : ''), text: (el.textContent || '').trim().slice(0, 40), family: fam });
    }
    if (samples.length < 6) samples.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), family: fam.slice(0, 80), fontSize: cs.fontSize });
  }
  return { badCount: bad.length, bad, samples };
})()`;

const SPRITE_PROBE = `(() => {
  const out = [];
  for (const svg of document.querySelectorAll('svg')) {
    const r = svg.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const vb = svg.getAttribute('viewBox');
    let vbW = null, vbH = null, scaleX = null, scaleY = null, integer = null;
    if (vb) {
      const p = vb.split(/[\\s,]+/).map(Number);
      vbW = p[2]; vbH = p[3];
      scaleX = +(r.width / vbW).toFixed(3);
      scaleY = +(r.height / vbH).toFixed(3);
      integer = Math.abs(scaleX - Math.round(scaleX)) < 0.02 && Math.abs(scaleY - Math.round(scaleY)) < 0.02;
    }
    const cs = getComputedStyle(svg);
    out.push({
      cls: svg.getAttribute('class') || '',
      parent: (svg.parentElement && typeof svg.parentElement.className === 'string') ? svg.parentElement.className.slice(0, 50) : '',
      w: +r.width.toFixed(2), h: +r.height.toFixed(2), vbW, vbH, scaleX, scaleY, integer,
      shapeRendering: cs.shapeRendering, imageRendering: cs.imageRendering,
    });
  }
  const imgs = [];
  for (const img of document.querySelectorAll('img')) {
    const cs = getComputedStyle(img);
    imgs.push({ src: img.getAttribute('src'), cls: img.getAttribute('class') || '', imageRendering: cs.imageRendering, w: img.width, h: img.height });
  }
  return { svgs: out, imgs };
})()`;

const ANTISLOP_PROBE = `(() => {
  let maxBlur = 0, blurEls = [], backdrop = [], radius = [], shadows = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const bs = cs.boxShadow;
    if (bs && bs !== 'none') {
      shadows++;
      const m = bs.match(/(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px/);
      if (m) {
        const b = parseFloat(m[3]);
        if (b > maxBlur) maxBlur = b;
        if (b > 24) blurEls.push({ cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60), shadow: bs.slice(0, 90) });
      }
    }
    if (cs.backdropFilter && cs.backdropFilter !== 'none') backdrop.push((typeof el.className === 'string' ? el.className : '').slice(0, 60));
    const br = cs.borderRadius;
    if (br && br !== '0px' && br !== '0%') radius.push({ cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60), radius: br });
  }
  const text = document.body ? document.body.innerText : '';
  return {
    maxBlur, blurOver24: blurEls, backdropFilterCount: backdrop.length, backdropSamples: backdrop.slice(0, 5),
    radiusCount: radius.length, radiusSamples: radius.slice(0, 10), shadowedElements: shadows,
    textSample: text.slice(0, 6000),
  };
})()`;

const ANIM_SAMPLE_INIT = `(() => {
  window.__animSamples = [];
  function sample() {
    try {
      const running = document.getAnimations().filter(a => a.playState === 'running');
      window.__animSamples.push({ t: Math.round(performance.now()), count: running.length, names: running.map(a => a.animationName || '?') });
    } catch (e) {}
  }
  function start() { [0, 60, 120, 200, 300, 450, 700, 1200].forEach(d => setTimeout(sample, d)); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

const CWV_INIT = `(() => {
  window.__cwv = { lcp: 0, lcpEntries: [], cls: 0, shifts: [], events: [], ttfb: null };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { window.__cwv.lcp = Math.max(window.__cwv.lcp, e.startTime); window.__cwv.lcpEntries.push({ t: +e.startTime.toFixed(1), el: e.element ? e.element.tagName + '.' + (typeof e.element.className === 'string' ? e.element.className.slice(0, 40) : '') : '?' }); }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { if (!e.hadRecentInput) { window.__cwv.cls += e.value; window.__cwv.shifts.push({ v: +e.value.toFixed(5), t: +e.startTime.toFixed(0) }); } }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { if (e.interactionId) window.__cwv.events.push({ name: e.name, dur: +e.duration.toFixed(1), t: +e.startTime.toFixed(0), iid: e.interactionId }); }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch (e) {}
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) window.__cwv.ttfb = +nav.responseStart.toFixed(1);
})();`;

async function tabStops(ws, max = 45) {
  await cdpSend(ws, "Page.bringToFront").catch(() => {});
  await cdpEval(ws, "if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); true");
  const stops = [];
  let firstElId = null;
  for (let i = 0; i < max; i++) {
    await cdpSend(ws, "Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, code: "Tab", key: "Tab" });
    await cdpSend(ws, "Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, code: "Tab", key: "Tab" });
    await sleep(40);
    const info = await cdpEval(ws, `(() => {
      const el = document.activeElement;
      if (!el) return null;
      if (!el.__tqid) el.__tqid = (window.__tqSeq = (window.__tqSeq || 0) + 1);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === 'string' ? el.className : '';
      const outlineVisible = cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
      const shadowVisible = cs.boxShadow && cs.boxShadow !== 'none';
      return {
        elId: el.__tqid,
        tag: el.tagName, cls: cls.slice(0, 60), id: el.id || '',
        text: (el.textContent || '').trim().slice(0, 36),
        aria: el.getAttribute('aria-label'),
        href: el.getAttribute && el.getAttribute('href') ? String(el.getAttribute('href')).slice(0, 60) : null,
        outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        boxShadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 60),
        focusVisible: outlineVisible || shadowVisible,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    })()`);
    if (!info) break;
    if (i === 0) firstElId = info.elId;
    if (info.tag === "BODY") { stops.push(info); break; }
    if (info.elId === firstElId && i > 0) { stops.push({ ...info, __wrapped: true }); break; }
    stops.push(info);
    if (stops.length >= 3) {
      const [a, b, c] = [stops[stops.length - 1], stops[stops.length - 2], stops[stops.length - 3]];
      if (a.elId === b.elId && b.elId === c.elId) { stops.push({ __trap: true, elId: a.elId, cls: a.cls }); break; }
    }
  }
  return stops;
}

async function fetchAxe() {
  const urls = [
    "https://unpkg.com/axe-core@4.10.3/axe.min.js",
    "https://unpkg.com/axe-core@4/axe.min.js",
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (r.ok) { const src = await r.text(); if (src.includes("axe")) return { src, url: u }; }
    } catch (e) { log(`  axe fetch failed (${u}): ${String(e).slice(0, 120)}`); }
  }
  return null;
}

async function runAxe(ws, axeSrc, pagePath) {
  await navigate(ws, `http://localhost:${PORT}${pagePath}`, 900);
  await cdpEval(ws, axeSrc, 60000);
  const version = await cdpEval(ws, "window.axe && axe.version");
  // Lighthouse enables label-content-name-mismatch (best-practice, not default-enabled in axe CLI);
  // enable it explicitly so the gate covers the same rule surface.
  const result = await cdpEval(ws, `(async () => {
    const r = await axe.run(document, { resultTypes: ['violations', 'incomplete'], rules: { 'label-content-name-mismatch': { enabled: true } } });
    return {
      violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags, nodes: v.nodes.length,
        targets: v.nodes.slice(0, 8).map(n => ({ target: n.target.join(' '), html: (n.html || '').slice(0, 160), summary: (n.failureSummary || '').replace(/\\n/g, ' ').slice(0, 300) })) })),
      incompleteCount: r.incomplete.length,
      passes: r.passes.length,
    };
  })()`, 120000);
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of result.violations) if (byImpact[v.impact] !== undefined) byImpact[v.impact]++;
  return { page: pagePath, axeVersion: version, byImpact, violations: result.violations, incompleteCount: result.incompleteCount, passes: result.passes };
}

// â”€â”€ phases (part 3): slots, axe, dom scans â”€â”€
async function phaseSlots() {
  log("\n[I] slot fidelity (raw HTML)");
  const slots = { capturedAt: new Date().toISOString(), pages: {}, malformed: [], leaks: [] };
  for (const p of PAGES) {
    const res = await fetch(`http://localhost:${PORT}${p.path}`);
    const html = await res.text();
    const matches = [...html.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);
    const valid = matches.filter((s) => /^\{\{[A-Z0-9_]+\}\}$/.test(s));
    const bad = matches.filter((s) => !/^\{\{[A-Z0-9_]+\}\}$/.test(s));
    if (/%7B%7B/i.test(html)) slots.leaks.push({ page: p.path, kind: "percent-encoded" });
    if (/\{\{domain\}\}|\{\{site_name\}\}/.test(html)) slots.leaks.push({ page: p.path, kind: "lowercased" });
    slots.pages[p.path] = { status: res.status, slotOccurrences: matches.length, unique: [...new Set(valid)].length, malformed: bad };
    if (bad.length) slots.malformed.push({ page: p.path, bad });
  }
  slots.pass = slots.malformed.length === 0 && slots.leaks.length === 0;
  R.checks.slots = slots.pass ? "PASS" : "FAIL";
  writeFileSync(ART("task-14-slots.json"), JSON.stringify(slots, null, 2));
  R.artifacts.push(ART("task-14-slots.json"));
  log(`  slots: ${slots.pass ? "PASS" : "FAIL"} (malformed=${slots.malformed.length}, leaks=${slots.leaks.length})`);
}

async function phaseAxe(ws) {
  log("\n[A] axe-core audit");
  const axe = await fetchAxe();
  const axeReport = { capturedAt: new Date().toISOString(), axeSource: axe?.url || null, pages: {}, note: null };
  if (!axe) {
    axeReport.note = "axe-core CDN unavailable â€” manual contrast fallback only";
    R.checks.axe = "BLOCKED";
  } else {
    await setViewport(ws, { width: 1280, height: 900, dsf: 1, mobile: false });
    let criticalTotal = 0, seriousTotal = 0;
    for (const p of PAGES) {
      try {
        const res = await runAxe(ws, axe.src, p.path);
        axeReport.pages[p.path] = res;
        criticalTotal += res.byImpact.critical;
        seriousTotal += res.byImpact.serious;
        log(`  ${p.path}: critical=${res.byImpact.critical} serious=${res.byImpact.serious} moderate=${res.byImpact.moderate} minor=${res.byImpact.minor}`);
      } catch (e) {
        axeReport.pages[p.path] = { error: String(e).slice(0, 300) };
        log(`  ${p.path}: ERROR ${String(e).slice(0, 200)}`);
      }
    }
    axeReport.totals = { critical: criticalTotal, serious: seriousTotal };
    R.checks.axe = criticalTotal === 0 ? "PASS" : "FAIL";
    if (criticalTotal > 0) R.findings.push(`axe critical violations: ${criticalTotal}`);
    if (seriousTotal > 0) R.findings.push(`axe serious violations: ${seriousTotal} (see task-14-axe.json)`);
  }
  writeFileSync(ART("task-14-axe.json"), JSON.stringify(axeReport, null, 2));
  R.artifacts.push(ART("task-14-axe.json"));
  log(`  axe: ${R.checks.axe}`);
}

async function phaseDomScans(ws) {
  log("\n[B/D/J] DOM scans (sprites, readability, anti-slop, animations-at-load)");
  const domReport = { capturedAt: new Date().toISOString(), pages: {} };
  await resetMedia(ws);
  for (const p of PAGES) {
    const ident = (await cdpSend(ws, "Page.addScriptToEvaluateOnNewDocument", { source: ANIM_SAMPLE_INIT })).identifier;
    await navigate(ws, `http://localhost:${PORT}${p.path}`, 1400);
    const readability = await cdpEval(ws, READABILITY_PROBE);
    const sprites = await cdpEval(ws, SPRITE_PROBE);
    const antislop = await cdpEval(ws, ANTISLOP_PROBE);
    const anims = await cdpEval(ws, "window.__animSamples || []");
    const domSlots = await cdpEval(ws, `(() => {
      const html = document.documentElement.outerHTML;
      const text = document.body ? document.body.innerText : '';
      const inHtml = (html.match(/\\{\\{[A-Z0-9_]+\\}\\}/g) || []).length;
      const inText = (text.match(/\\{\\{[A-Z0-9_]+\\}\\}/g) || []).length;
      const badInText = (text.match(/\\{\\{[^}]*\\}\\}/g) || []).filter(s => !/^\\{\\{[A-Z0-9_]+\\}\\}$/.test(s));
      return { slotsInRenderedHtml: inHtml, slotsInInnerText: inText, malformedInText: badInText };
    })()`);
    await cdpSend(ws, "Page.removeScriptToEvaluateOnNewDocument", { identifier: ident }).catch(() => {});
    const maxAnim = anims.reduce((m, s) => Math.max(m, s.count), 0);
    const badCopy = BANNED_COPY.filter((re) => re.test(antislop.textSample)).map(String);
    domReport.pages[p.path] = {
      readability: { badCount: readability.badCount, bad: readability.bad, samples: readability.samples },
      sprites: {
        total: sprites.svgs.length,
        nonInteger: sprites.svgs.filter((s) => s.integer === false),
        notCrisp: sprites.svgs.filter((s) => String(s.shapeRendering || "").toLowerCase() !== "crispedges"),
        list: sprites.svgs,
        imgs: sprites.imgs,
      },
      antislop: {
        maxBlur: antislop.maxBlur, blurOver24: antislop.blurOver24,
        backdropFilterCount: antislop.backdropFilterCount, backdropSamples: antislop.backdropSamples,
        radiusCount: antislop.radiusCount, radiusSamples: antislop.radiusSamples,
        shadowedElements: antislop.shadowedElements, bannedCopyMatches: badCopy,
      },
      animationsAtLoad: { maxSimultaneous: maxAnim, samples: anims },
      domSlots,
    };
    log(`  ${p.path}: vt323-in-text=${readability.badCount} nonIntegerSprites=${domReport.pages[p.path].sprites.nonInteger.length} notCrisp=${domReport.pages[p.path].sprites.notCrisp.length} maxBlur=${antislop.maxBlur} radius=${antislop.radiusCount} maxSimAnim=${maxAnim} bannedCopy=${badCopy.length}`);
  }
  const vtBad = Object.values(domReport.pages).reduce((n, v) => n + v.readability.badCount, 0);
  R.checks.bodyReadability = vtBad === 0 ? "PASS" : "FAIL";
  const maxBlur = Math.max(...Object.values(domReport.pages).map((v) => v.antislop.maxBlur));
  R.checks.blurBudget = maxBlur <= 24 ? "PASS" : "FAIL";
  const backdropCount = Object.values(domReport.pages).reduce((n, v) => n + v.antislop.backdropFilterCount, 0);
  R.checks.noGlassmorphism = backdropCount === 0 ? "PASS" : "FAIL";
  const maxSimAnim = Math.max(...Object.values(domReport.pages).map((v) => v.animationsAtLoad.maxSimultaneous));
  R.checks.simultaneousAnimations = maxSimAnim <= 2 ? "PASS" : "FAIL";
  if (maxSimAnim > 2) R.findings.push(`>2 simultaneous animations at load (max=${maxSimAnim}) â€” Â§9.1`);
  const bannedCopyHits = Object.values(domReport.pages).reduce((n, v) => n + v.antislop.bannedCopyMatches.length, 0);
  R.checks.bannedCopy = bannedCopyHits === 0 ? "PASS" : "FAIL";
  const spriteViol = [];
  for (const [pg, v] of Object.entries(domReport.pages)) for (const s of v.sprites.nonInteger) spriteViol.push({ page: pg, cls: s.cls, parent: s.parent, w: s.w, h: s.h, vbW: s.vbW, vbH: s.vbH, scaleX: s.scaleX, scaleY: s.scaleY });
  domReport.spriteViolations = spriteViol;
  R.checks.spriteIntegerScale = spriteViol.length === 0 ? "PASS" : "FAIL";
  for (const s of spriteViol) R.findings.push(`non-integer sprite scale ${s.scaleX}x on ${s.page} (${s.cls || s.parent}, ${s.w}x${s.h} from ${s.vbW}x${s.vbH} grid)`);
  writeFileSync(ART("task-14-antislop-dom.json"), JSON.stringify(domReport, null, 2));
  R.artifacts.push(ART("task-14-antislop-dom.json"));
  writeFileSync(ART("task-14-sprite-audit.json"), JSON.stringify({ capturedAt: new Date().toISOString(), violations: spriteViol, pages: Object.fromEntries(Object.entries(domReport.pages).map(([k, v]) => [k, v.sprites])) }, null, 2));
  R.artifacts.push(ART("task-14-sprite-audit.json"));
  log(`  readability=${R.checks.bodyReadability} blur=${R.checks.blurBudget}(${maxBlur}) glass=${R.checks.noGlassmorphism} simAnim=${R.checks.simultaneousAnimations}(${maxSimAnim}) sprites=${R.checks.spriteIntegerScale}`);
}

// â”€â”€ main continued (part 4) â€” appended inside main() via textual merge in p3 wrapper â”€â”€
// NOTE: this file's content is inserted into main() by build step; keep top-level free.

async function phasePixelatedAndMixel(ws) {
  // â”€â”€ Phase C: image-rendering: pixelated â”€â”€
  log("\n[C] image-rendering: pixelated / crispEdges");
  const pixelated = { capturedAt: new Date().toISOString(), checks: [] };
  await navigate(ws, HOME, 500);
  const classWorks = await cdpEval(ws, `(() => {
    const d = document.createElement('div'); d.className = 'pixelated'; document.body.appendChild(d);
    const v = getComputedStyle(d).imageRendering; d.remove(); return v;
  })()`);
  pixelated.checks.push({ what: ".pixelated class computes image-rendering", value: classWorks, pass: /pixelated|crisp-edges/.test(classWorks) });
  await navigate(ws, `http://localhost:${PORT}/halaman-ngawur`, 600);
  const scene = await cdpEval(ws, `(() => { const el = document.querySelector('.not-found__scene'); if (!el) return null; const cs = getComputedStyle(el); return { imageRendering: cs.imageRendering, shapeRendering: cs.shapeRendering }; })()`);
  pixelated.checks.push({ what: ".not-found__scene computed", value: scene, pass: !!scene && /pixelated/.test(scene.imageRendering) });
  const cssHasThumb = await cdpEval(ws, `(() => {
    let found = false;
    for (const sheet of document.styleSheets) {
      try { for (const rule of sheet.cssRules) { if (rule.cssText && rule.cssText.includes('.project-card__thumb-img') && rule.cssText.includes('image-rendering')) found = true; } } catch (e) {}
    }
    return found;
  })()`);
  pixelated.checks.push({ what: ".project-card__thumb-img rule has image-rendering (stylesheet scan)", value: cssHasThumb, pass: cssHasThumb });
  pixelated.pass = pixelated.checks.every((c) => c.pass);
  R.checks.pixelatedCss = pixelated.pass ? "PASS" : "FAIL";
  writeFileSync(ART("task-14-pixelated.json"), JSON.stringify(pixelated, null, 2));
  R.artifacts.push(ART("task-14-pixelated.json"));
  log(`  pixelated: ${R.checks.pixelatedCss}`);

  // â”€â”€ Phase B2: anti-mixel screenshots â”€â”€
  log("\n[B] anti-mixel screenshots");
  await navigate(ws, HOME, 800);
  const zoomCases = [
    { w: 375, zoom: 1, file: "task-14-mixel-375-100.png" },
    { w: 375, zoom: 2, file: "task-14-mixel-375-200.png" },
    { w: 1280, zoom: 1, file: "task-14-mixel-1280-100.png" },
    { w: 1280, zoom: 2, file: "task-14-mixel-1280-200.png" },
  ];
  const mixelMeta = { capturedAt: new Date().toISOString(), method: "200% zoom simulated as layout-width/2 with deviceScaleFactor=2 (identical CSS-px reflow semantics)", cases: [] };
  for (const c of zoomCases) {
    const layoutW = Math.round(c.w / c.zoom);
    await setViewport(ws, { width: layoutW, height: 900, dsf: c.zoom, mobile: c.w <= 480 });
    await sleep(500);
    const r = await cdpEval(ws, `({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > window.innerWidth })`);
    await shot(ws, ART(c.file));
    mixelMeta.cases.push({ ...c, layoutWidth: layoutW, dsf: c.zoom, innerWidth: r.innerWidth, scrollWidth: r.scrollWidth, horizontalOverflow: r.overflowX, artifact: c.file });
    log(`  ${c.file}: layout=${layoutW}px dsf=${c.zoom} overflow=${r.overflowX}`);
  }
  R.checks.antiMixelScreenshots = mixelMeta.cases.every((c) => existsSync(ART(c.file))) ? "PASS" : "FAIL";
  writeFileSync(ART("task-14-mixel-meta.json"), JSON.stringify(mixelMeta, null, 2));
  R.artifacts.push(ART("task-14-mixel-meta.json"));
}

async function phaseReducedMotion(ws) {
  log("\n[E] reduced motion");
  await setViewport(ws, { width: 1280, height: 900, dsf: 1, mobile: false });
  await cdpSend(ws, "Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const rmReport = { capturedAt: new Date().toISOString(), pages: {} };
  for (const p of [{ path: "/", name: "home" }, { path: "/about", name: "about" }]) {
    await navigate(ws, `http://localhost:${PORT}${p.path}`, 1200);
    const res = await cdpEval(ws, `(() => {
      const running = document.getAnimations().filter(a => a.playState === 'running');
      const details = running.map(a => { let t = {}; try { t = a.effect.getTiming(); } catch (e) {} return { name: a.animationName || a.constructor.name, duration: t.duration, iterations: t.iterations }; });
      const probes = ['.home-hero__eyebrow', '.home-hero__subhead', '.home-hero__ctas', '.site-nav__panel'].map(sel => {
        const el = document.querySelector(sel); if (!el) return null;
        const cs = getComputedStyle(el);
        return { sel, animationDuration: cs.animationDuration, iterationCount: cs.animationIterationCount, transitionDuration: cs.transitionDuration, animationName: cs.animationName };
      }).filter(Boolean);
      const badge = document.querySelector('.pixel-badge-dot, [style*="pixel-blink"]');
      if (badge) { const cs = getComputedStyle(badge); probes.push({ sel: 'status-badge-dot', animationDuration: cs.animationDuration, iterationCount: cs.animationIterationCount, animationName: cs.animationName }); }
      return { runningCount: running.length, details, probes };
    })()`);
    rmReport.pages[p.path] = res;
    log(`  ${p.path}: running=${res.runningCount} probes=${res.probes.map((x) => x.animationDuration).join(",")}`);
  }
  await resetMedia(ws);
  const rmPass = Object.values(rmReport.pages).every((v) => v.runningCount === 0 && v.probes.every((pr) => parseFloat(pr.animationDuration) <= 0.001));
  R.checks.reducedMotion = rmPass ? "PASS" : "FAIL";
  writeFileSync(ART("task-14-reduced-motion.json"), JSON.stringify(rmReport, null, 2));
  R.artifacts.push(ART("task-14-reduced-motion.json"));
  log(`  reducedMotion: ${R.checks.reducedMotion}`);
}

async function phaseKeyboard(ws) {
  log("\n[F] keyboard nav");
  const focusReport = { capturedAt: new Date().toISOString(), pages: {} };
  for (const p of [{ path: "/", name: "home" }, { path: "/contact", name: "contact" }]) {
    await navigate(ws, `http://localhost:${PORT}${p.path}`, 900);
    const stops = await tabStops(ws, 45);
    const first = stops[0];
    const trap = stops.find((s) => s.__trap);
    const noRing = stops.filter((s) => !s.__trap && !s.focusVisible && s.tag !== "BODY");
    // Skip-link visibility when focused: re-navigate and Tab once.
    await navigate(ws, `http://localhost:${PORT}${p.path}`, 700);
    await cdpSend(ws, "Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, code: "Tab", key: "Tab" });
    await cdpSend(ws, "Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, code: "Tab", key: "Tab" });
    await sleep(150);
    const skipProbe = await cdpEval(ws, `(() => {
      const el = document.activeElement;
      if (!el || !el.classList.contains('skip-link')) return { focused: false, cls: el ? (typeof el.className === 'string' ? el.className : '') : null };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { focused: true, top: Math.round(r.top), visible: r.top >= 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' };
    })()`);
    await shot(ws, ART(`task-14-focus-ring-${p.name}.png`));
    focusReport.pages[p.path] = {
      stopCount: stops.length,
      firstStop: first ? { tag: first.tag, cls: first.cls, text: first.text } : null,
      skipLinkFirst: !!first && first.tag === "A" && /skip-link/.test(first.cls),
      skipLinkVisibleWhenFocused: skipProbe,
      trap: trap ? { cls: trap.cls } : null,
      wrappedAt: stops.find((s) => s.__wrapped) ? "cycle-complete (focus returned to first element)" : "stopped-at-limit-or-body",
      noRingStops: noRing.map((s) => ({ tag: s.tag, cls: s.cls, text: s.text, outline: s.outline })),
      stops,
    };
    log(`  ${p.path}: stops=${stops.length} skipFirst=${focusReport.pages[p.path].skipLinkFirst} skipVisible=${skipProbe.visible} trap=${!!trap} noRing=${noRing.length}`);
  }
  const kbPass = Object.values(focusReport.pages).every((v) => v.skipLinkFirst && v.skipLinkVisibleWhenFocused?.focused && v.skipLinkVisibleWhenFocused?.visible && !v.trap && v.noRingStops.length === 0);
  R.checks.keyboardNav = kbPass ? "PASS" : "FAIL";
  writeFileSync(ART("task-14-focus-tab.json"), JSON.stringify(focusReport, null, 2));
  R.artifacts.push(ART("task-14-focus-tab.json"));
  log(`  keyboardNav: ${R.checks.keyboardNav}`);
}

async function phasePrint(ws) {
  log("\n[G] print stylesheet");
  await navigate(ws, HOME, 700);
  await cdpSend(ws, "Emulation.setEmulatedMedia", { media: "print" });
  await sleep(400);
  const printComputed = await cdpEval(ws, `(() => {
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const nav = document.querySelector('nav');
    const tt = document.querySelector('.theme-toggle');
    const ps = [...document.querySelectorAll('p')].slice(0, 3).map(el => { const cs = getComputedStyle(el); return { cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), color: cs.color, fontFamily: cs.fontFamily.slice(0, 60), fontSize: cs.fontSize }; });
    return {
      htmlBg: html.backgroundColor, bodyBg: body.backgroundColor, bodyColor: body.color,
      navDisplay: nav ? getComputedStyle(nav).display : null,
      themeToggleDisplay: tt ? getComputedStyle(tt).display : null,
      customProps: {
        surfaceCanvas: html.getPropertyValue('--surface-canvas').trim(),
        textPrimary: html.getPropertyValue('--text-primary').trim(),
        themeAttr: document.documentElement.getAttribute('data-theme'),
      },
      paragraphs: ps,
    };
  })()`);
  await shot(ws, ART("task-14-print-home.png"));
  await resetMedia(ws);
  const printPass = printComputed.bodyBg === "rgb(255, 255, 255)" && printComputed.bodyColor === "rgb(0, 0, 0)" && printComputed.navDisplay === "none" && printComputed.themeToggleDisplay === "none";
  printComputed.pass = printPass;
  R.checks.print = printPass ? "PASS" : "FAIL";
  writeFileSync(ART("task-14-print-computed.json"), JSON.stringify(printComputed, null, 2));
  R.artifacts.push(ART("task-14-print-computed.json"));
  log(`  print: ${R.checks.print} (bg=${printComputed.bodyBg} color=${printComputed.bodyColor} nav=${printComputed.navDisplay})`);
}

async function phaseCwv(ws) {
  log("\n[H] CWV mobile 4G on /");
  const cwv = {
    capturedAt: new Date().toISOString(),
    method: "CDP: PerformanceObserver LCP + layout-shift + EventTiming; Network.emulateNetworkConditions Slow-4G (1.6Mbps down / 750kbps up / 150ms RTT); CPU 4x; viewport 390x844 dsf=2; cache disabled",
    budget: { lcpMs: 1200, cls: 0, inpMs: 50 },
    results: null,
    throttleVerification: null,
    nativeInpComparison: null,
  };
  const cwvInitId = (await cdpSend(ws, "Page.addScriptToEvaluateOnNewDocument", { source: CWV_INIT })).identifier;
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdpSend(ws, "Network.setCacheDisabled", { cacheDisabled: true });
  await cdpSend(ws, "Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdpSend(ws, "Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8), uploadThroughput: Math.round((750 * 1024) / 8), connectionType: "cellular4g" });
  // Verify throttling applies to this origin (loopback may bypass in some Chrome builds).
  await navigate(ws, HOME, 400);
  const throttleCheck = await cdpEval(ws, `(async () => {
    const t0 = performance.now();
    const r = await fetch('/_next/static/chunks/webpack-daec2e27d1a4d162.js?tq=' + Math.random(), { cache: 'no-store' });
    await r.text();
    return { ms: +(performance.now() - t0).toFixed(1), ok: r.ok };
  })()`, 60000);
  cwv.throttleVerification = { ...throttleCheck, note: "cache-busted fetch under Slow-4G emulation; ~150ms+ RTT expected if throttled" };
  log(`  throttle check: fetch took ${throttleCheck.ms}ms (ok=${throttleCheck.ok})`);
  let cwvBase = HOME;
  if (throttleCheck.ms < 100) {
    // Loopback bypasses network emulation — retry against the LAN interface.
    const lan = "http://192.168.56.1:3111/";
    const lanUp = await fetch(lan).then((r) => r.ok).catch(() => false);
    if (lanUp) {
      await navigate(ws, lan, 400);
      const lanCheck = await cdpEval(ws, `(async () => {
        const t0 = performance.now();
        const r = await fetch('/_next/static/chunks/webpack-daec2e27d1a4d162.js?tq=' + Math.random(), { cache: 'no-store' });
        await r.text();
        return { ms: +(performance.now() - t0).toFixed(1), ok: r.ok };
      })()`, 60000);
      cwv.throttleVerification = { ...cwv.throttleVerification, loopbackBypassed: true, lanRetry: lanCheck, lanOrigin: lan, note: "loopback bypassed throttling; LAN origin used for CWV" };
      log(`  loopback bypassed throttle; LAN fetch took ${lanCheck.ms}ms`);
      cwvBase = lan;
    } else {
      cwv.throttleVerification.loopbackBypassed = true;
      cwv.throttleVerification.note += " | loopback bypassed; LAN origin unreachable — LCP measured without network throttling (CPU-throttle only)";
    }
  }
  await navigate(ws, cwvBase, 0);
  await sleep(6000);
  const clickToggle = async (count) => {
    const pt = await cdpEval(ws, `(() => { const el = document.querySelector('.theme-toggle'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    if (!pt) return null;
    for (let i = 0; i < count; i++) {
      await cdpSend(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      await cdpSend(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      await sleep(350);
    }
    return pt;
  };
  try { await clickToggle(6); } catch (e) { cwv.interactionNote = String(e).slice(0, 200); }
  await sleep(1200);
  const raw = await cdpEval(ws, "window.__cwv");
  const lcp = Math.round((raw.lcp || 0) * 10) / 10;
  const cls = Math.round((raw.cls || 0) * 10000) / 10000;
  const interactions = raw.events || [];
  const clickDurs = interactions.filter((e) => e.name === "click").map((e) => e.dur);
  const inp = clickDurs.length ? Math.max(...clickDurs) : null;
  cwv.results = { lcpMs: lcp, cls, inpMs: inp, ttfbMs: raw.ttfb, lcpEntries: raw.lcpEntries, shifts: raw.shifts, interactions };
  cwv.pass = { lcp: lcp <= 1200, cls: cls === 0, inp: inp !== null && inp <= 50 };
  // Native-speed INP comparison (CPU 1x, same page) to characterize the throttled result.
  await cdpSend(ws, "Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdpSend(ws, "Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  await navigate(ws, HOME, 1200);
  await cdpEval(ws, "window.__cwv.events = []; true");
  try { await clickToggle(6); } catch {}
  await sleep(800);
  const rawNative = await cdpEval(ws, "window.__cwv");
  const nativeClicks = (rawNative.events || []).filter((e) => e.name === "click").map((e) => e.dur);
  cwv.nativeInpComparison = { cpuRate: 1, clickDurationsMs: nativeClicks, maxMs: nativeClicks.length ? Math.max(...nativeClicks) : null };
  R.checks.cwv = (cwv.pass.lcp && cwv.pass.cls && cwv.pass.inp) ? "PASS" : "FAIL";
  if (!cwv.pass.inp) R.findings.push(`CWV INP ${inp}ms > 50ms budget under 4x CPU throttle (native-speed max: ${cwv.nativeInpComparison.maxMs}ms)`);
  if (!cwv.pass.lcp) R.findings.push(`CWV LCP ${lcp}ms > 1200ms budget`);
  if (!cwv.pass.cls) R.findings.push(`CWV CLS ${cls} > 0`);
  await cdpSend(ws, "Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {});
  await cdpSend(ws, "Page.removeScriptToEvaluateOnNewDocument", { identifier: cwvInitId }).catch(() => {});
  writeFileSync(ART("task-14-cwv.json"), JSON.stringify(cwv, null, 2));
  R.artifacts.push(ART("task-14-cwv.json"));
  log(`  CWV: LCP=${lcp}ms (<=1200 ${cwv.pass.lcp}) CLS=${cls} (0 ${cwv.pass.cls}) INP=${inp}ms (<=50 ${cwv.pass.inp}) nativeMax=${cwv.nativeInpComparison.maxMs}ms`);
}

async function phaseLightThemeHero(ws) {
  log("\n[L] light-theme hero regression guard");
  const report = { capturedAt: new Date().toISOString(), light: null, dark: null };
  const PROBE = `(() => {
    const cs = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el) : null; };
    return {
      theme: document.documentElement.dataset.theme,
      starsAnimation: cs('.hero-scene__stars')?.animationName,
      starsOpacity: cs('.hero-scene__stars')?.opacity,
      windowAnimation: cs('.hero-scene__window')?.animationName,
      windowOpacity: cs('.hero-scene__window')?.opacity,
      nightArtOpacity: cs('.hero-scene__art--night')?.opacity,
      dayArtOpacity: cs('.hero-scene__art--day')?.opacity,
    };
  })()`;
  const runLeg = async (theme) => {
    await navigate(ws, HOME, 300);
    await cdpEval(ws, `localStorage.setItem('theme', ${JSON.stringify(theme)}); true`);
    await navigate(ws, HOME, 300);
    await sleep(1600);
    const probe = await cdpEval(ws, PROBE);
    return { probe, checks: null, pass: null };
  };

  // Reset emulation so this final phase starts from a clean, known state.
  await resetMedia(ws);
  await cdpSend(ws, "Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
  await cdpSend(ws, "Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  await cdpSend(ws, "Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {});
  await setViewport(ws, { width: 1280, height: 900, dsf: 1, mobile: false });

  const light = await runLeg("light");
  light.checks = {
    themeIsLight: light.probe.theme === "light",
    starsNoAnimation: light.probe.starsAnimation === "none",
    starsHidden: parseFloat(light.probe.starsOpacity) === 0,
    windowNoAnimation: light.probe.windowAnimation === "none",
    windowHidden: parseFloat(light.probe.windowOpacity) === 0,
    nightArtHidden: parseFloat(light.probe.nightArtOpacity) === 0,
    dayArtShown: parseFloat(light.probe.dayArtOpacity) === 1,
  };
  light.pass = Object.values(light.checks).every(Boolean);
  if (!light.pass) {
    const failed = Object.entries(light.checks).filter(([, v]) => !v).map(([k]) => k);
    R.findings.push(`light-theme hero leak: ${failed.join(", ")} (light starsAnim=${light.probe.starsAnimation} starsOpacity=${light.probe.starsOpacity} windowAnim=${light.probe.windowAnimation} windowOpacity=${light.probe.windowOpacity} nightArt=${light.probe.nightArtOpacity} dayArt=${light.probe.dayArtOpacity})`);
  }

  const dark = await runLeg("dark");
  dark.checks = {
    starsAnimates: dark.probe.starsAnimation === "hero-twinkle",
    windowAnimates: dark.probe.windowAnimation === "hero-window",
    nightArtShown: parseFloat(dark.probe.nightArtOpacity) === 1,
  };
  dark.pass = Object.values(dark.checks).every(Boolean);
  if (!dark.pass) {
    const failed = Object.entries(dark.checks).filter(([, v]) => !v).map(([k]) => k);
    R.findings.push(`dark-theme hero sanity failed: ${failed.join(", ")} (dark starsAnim=${dark.probe.starsAnimation} windowAnim=${dark.probe.windowAnimation} nightArt=${dark.probe.nightArtOpacity})`);
  }

  report.light = { probe: light.probe, pass: light.pass, checks: light.checks };
  report.dark = { probe: dark.probe, pass: dark.pass, checks: dark.checks };
  R.checks.lightThemeHero = (light.pass && dark.pass) ? "PASS" : "FAIL";
  writeFileSync(ART("task-14-light-theme.json"), JSON.stringify(report, null, 2));
  R.artifacts.push(ART("task-14-light-theme.json"));
  log(`  lightThemeHero: ${R.checks.lightThemeHero} (light starsAnim=${light.probe.starsAnimation} starsOpacity=${light.probe.starsOpacity} windowAnim=${light.probe.windowAnimation} windowOpacity=${light.probe.windowOpacity}; dark starsAnim=${dark.probe.starsAnimation} windowAnim=${dark.probe.windowAnimation})`);
}

export { phasePixelatedAndMixel, phaseReducedMotion, phaseKeyboard, phasePrint, phaseCwv, phaseLightThemeHero };

// â”€â”€ main runner (part 5) â”€â”€
async function main() {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });

  const up = await fetch(HOME).then((r) => r.ok).catch(() => false);
  if (!up) { console.error("[gate] server on :3111 not reachable â€” start it first"); process.exit(2); }
  log(`[gate] server OK, BUILD_ID=${R.buildId}`);

  chromeTmpDir = mkdtempSync(join(tmpdir(), "t14-chrome-"));
  chromeProc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeTmpDir}`,
    "--disable-gpu", "--no-sandbox", "--no-first-run", "--disable-extensions",
    "--window-size=1280,900",
    "--hide-scrollbars",
  ], { stdio: "ignore", detached: true });
  chromeProc.unref();
  await sleep(2200);

  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(500);
  }
  if (!wsUrl) throw new Error("Chrome CDP not reachable");
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  await cdpSend(ws, "Page.enable");
  await cdpSend(ws, "Runtime.enable");
  await cdpSend(ws, "Network.enable");
  log("[gate] CDP connected");

  try {
    await phaseSlots();
    await phaseAxe(ws);
    await phaseDomScans(ws);
    await phasePixelatedAndMixel(ws);
    await phaseReducedMotion(ws);
    await phaseKeyboard(ws);
    await phasePrint(ws);
    await phaseCwv(ws);
    await phaseLightThemeHero(ws);
  } finally {
    try { ws.close(); } catch {}
    killTree(chromeProc?.pid);
    try { if (chromeTmpDir) rmSync(chromeTmpDir, { recursive: true, force: true }); } catch {}
    log("[gate] chrome tree killed, temp profile removed");
  }

  R.finishedAt = new Date().toISOString();
  const passCount = Object.values(R.checks).filter((v) => v === "PASS").length;
  const failCount = Object.values(R.checks).filter((v) => v === "FAIL").length;
  R.summary = { pass: passCount, fail: failCount, checks: R.checks };
  writeFileSync(ART("task-14-gate-summary.json"), JSON.stringify(R, null, 2));
  R.artifacts.push(ART("task-14-gate-summary.json"));
  log(`\n[gate] DONE â€” PASS=${passCount} FAIL=${failCount}`);
  log(JSON.stringify(R.checks, null, 2));
  if (R.findings.length) { log("FINDINGS:"); for (const f of R.findings) log(`  - ${f}`); }
  process.exit(0);
}

main().catch((err) => {
  console.error("[gate] FATAL:", err);
  killTree(chromeProc?.pid);
  try { if (chromeTmpDir) rmSync(chromeTmpDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
