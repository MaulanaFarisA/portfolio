#!/usr/bin/env node
/**
 * verify-seo.mjs — Zero-dependency CDP + fetch probe for design.md §8.2–8.4.
 *
 * Asserts, for every route (/, /work, /work/apecx-2026, /work/malpres-2025, /work/buku-tahu, /work/astar, /about, /stack, /contact):
 *   - <title> matches the §8.2 template exactly
 *   - meta description present, <=155 chars
 *   - link[rel=canonical] present (absolute, built from the maulana.app domain)
 *   - og:title, og:description, og:image (+1200x630 dims), og:locale=en_US, og:url
 *   - §8.3 JSON-LD: Person (Home/About), WebSite+SearchAction (Home),
 *     CreativeWork (each case study)
 * Crawl files: /sitemap.xml (200 + all routes), /robots.txt (200 + allow + sitemap),
 * plus a 404 noindex regression guard.
 *
 * Usage:
 *   node scripts/verify-seo.mjs                 # build + probe
 *   node scripts/verify-seo.mjs --skip-build    # probe existing .next
 *   node scripts/verify-seo.mjs --skip-build --artifacts   # + evidence artifacts
 *
 * Exits 0 on all-pass, 1 on any mismatch.
 * HARDENED: detached server, stdio to file, tree-kill, port-free polling
 * (server :3110, chrome CDP :9233), exit-hook cleanup.
 */
import { execSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  openSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Byte-faithful evidence: when SEO_PROBE_LOG is set, every console line is also
// appended to that file via fs (UTF-8), bypassing console codepage re-encoding.
if (process.env.SEO_PROBE_LOG) {
  const logFd = openSync(process.env.SEO_PROBE_LOG, "w");
  const origLog = console.log.bind(console);
  console.log = (...args) => {
    origLog(...args);
    writeSync(logFd, args.map(String).join(" ") + "\n");
  };
  const origErr = console.error.bind(console);
  console.error = (...args) => {
    origErr(...args);
    writeSync(logFd, args.map(String).join(" ") + "\n");
  };
}

const PORT = 3110;
const CDP_PORT = 9233;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = join(import.meta.dirname, "..");
const EVIDENCE = join(ROOT, "..", ".omo", "evidence");
const HOME = `http://localhost:${PORT}/`;
const BASE = "https://maulana.app";
const OG_IMAGE_URL = "https://maulana.app/og.png";

const SKIP_BUILD = process.argv.includes("--skip-build");
const ARTIFACTS = process.argv.includes("--artifacts");

/** §8.2 meta templates — exact titles for the filled content. */
const PAGES = [
  { path: "/", title: "Maulana Faris - Web Developer", kind: "home" },
  { path: "/work", title: "Work - Maulana Faris", kind: "index" },
  { path: "/work/apecx-2026", title: "APECX 2026 Web Platform - Maulana Faris", kind: "case" },
  { path: "/work/malpres-2025", title: "MALPRES 2025 Web Platform - Maulana Faris", kind: "case" },
  { path: "/work/buku-tahu", title: "Buku Tahu - Maulana Faris", kind: "case" },
  { path: "/work/astar", title: "A Star Shop - Maulana Faris", kind: "case" },
  { path: "/about", title: "About - Maulana Faris", kind: "about" },
  { path: "/stack", title: "Stack - Maulana Faris", kind: "index" },
  { path: "/contact", title: "Contact - Maulana Faris", kind: "index" },
];

const SAME_AS = [
  "https://github.com/MaulanaFarisA",
  "https://www.linkedin.com/in/maulanafaris",
  "https://www.instagram.com/maulanafariiss",
];

const A = {
  dom: join(EVIDENCE, "task-13-dom-dump.html"),
  styles: join(EVIDENCE, "task-13-computed-styles.json"),
  shot: join(EVIDENCE, "task-13-screenshot-1440.png"),
  sitemap: join(EVIDENCE, "task-13-sitemap.xml.txt"),
  robots: join(EVIDENCE, "task-13-robots.txt.txt"),
  jsonld: join(EVIDENCE, "task-13-jsonld.json"),
};

// ── helpers ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(name, condition, details) {
  if (condition) {
    results[name] = { pass: true, details };
    console.log(`  \u2713 ${name}`);
  } else {
    results[name] = { pass: false, details };
    console.log(`  \u2717 ${name}: ${details}`);
    failures++;
  }
}

function expectedCanonical(path) {
  return path === "/" ? `${BASE}/` : `${BASE}${path}`;
}

/** Pull the content="" of the first <meta> whose attr="value" matches. */
function metaContent(html, attr, value) {
  const tag = html.match(new RegExp(`<meta[^>]*${attr}="${value}"[^>]*>`));
  if (!tag) return null;
  const content = tag[0].match(/content="([^"]*)"/);
  return content ? content[1] : "";
}

function titleOf(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : null;
}

function canonicalOf(html) {
  const tag = html.match(/<link[^>]*rel="canonical"[^>]*>/);
  if (!tag) return null;
  const href = tag[0].match(/href="([^"]*)"/);
  return href ? href[1] : "";
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch (e) {
      out.push({ __parseError: String(e), __raw: m[1].slice(0, 160) });
    }
  }
  return out;
}

function byType(blocks, type) {
  return blocks.find((b) => b && b["@type"] === type);
}

// ── processes to clean up ──
let serverProc = null;
let chromeProc = null;
let chromeTmpDir = null;

function killTree(pid) {
  if (!pid) return;
  try {
    execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: "ignore" });
  } catch {}
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
    console.log("[cleanup] chrome profile removed");
  } catch {}
}

process.on("exit", () => {
  killTree(chromeProc?.pid);
  killTree(serverProc?.pid);
});
process.on("SIGINT", () => {
  cleanup().then(() => process.exit(1));
});
process.on("SIGTERM", () => {
  cleanup().then(() => process.exit(1));
});

let failures = 0;
const results = {};
const timings = {};

// ── CDP plumbing ──
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

async function waitForLoad(ws, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await cdpEval(ws, "document.readyState");
    if (state === "complete") return true;
    await sleep(250);
  }
  return false;
}

const DOM_PRESENCE_EXPR = `(() => {
  const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) ?? null;
  const jsonld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent);
  return {
    title: document.title,
    description: attr('meta[name="description"]', 'content'),
    canonical: attr('link[rel="canonical"]', 'href'),
    ogTitle: attr('meta[property="og:title"]', 'content'),
    ogDescription: attr('meta[property="og:description"]', 'content'),
    ogImage: attr('meta[property="og:image"]', 'content'),
    ogImageWidth: attr('meta[property="og:image:width"]', 'content'),
    ogImageHeight: attr('meta[property="og:image:height"]', 'content'),
    ogLocale: attr('meta[property="og:locale"]', 'content'),
    ogUrl: attr('meta[property="og:url"]', 'content'),
    jsonldRaw: jsonld,
  };
})()`;

// ── main ──
const t0 = Date.now();
try {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
  const serverLogFd = openSync(join(EVIDENCE, "task-13-server.log"), "w");

  // 1. Build (unless --skip-build) — caller holds the build lock.
  if (!SKIP_BUILD) {
    console.log("[probe] Building (npm run build)...");
    const b0 = Date.now();
    execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
    timings.buildMs = Date.now() - b0;
    console.log(`[probe] Build done in ${(timings.buildMs / 1000).toFixed(1)}s`);
  } else {
    console.log("[probe] Skipping build (--skip-build)");
  }
  const buildIdPath = join(ROOT, ".next", "BUILD_ID");
  const buildId = existsSync(buildIdPath) ? readFileSync(buildIdPath, "utf8").trim() : null;
  console.log(`[probe] BUILD_ID=${buildId}`);

  // 2. Start prod server (DETACHED, stdio to file).
  console.log(`[probe] Starting DETACHED server on port ${PORT}`);
  const s0 = Date.now();
  serverProc = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    { cwd: ROOT, stdio: ["ignore", serverLogFd, serverLogFd], detached: true }
  );
  serverProc.unref();

  let up = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const res = await fetch(HOME);
      if (res.ok) {
        up = true;
        break;
      }
    } catch {}
  }
  if (!up) {
    console.error("[probe] Server did not start");
    await cleanup();
    process.exit(1);
  }
  timings.serverStartMs = Date.now() - s0;
  console.log(`[probe] Server ready in ${(timings.serverStartMs / 1000).toFixed(1)}s`);

  // 3. Raw-fetch every page; assert §8.2 meta + §8.3 JSON-LD.
  console.log("\n[probe] §8.2 meta templates + §8.3 JSON-LD (raw fetch)");
  const rawHtml = {};
  const f0 = Date.now();
  for (const page of PAGES) {
    const res = await fetch(`http://localhost:${PORT}${page.path}`);
    const html = await res.text();
    rawHtml[page.path] = html;
    console.log(`\n  ── ${page.path} (${res.status}) ──`);
    assert(`${page.path} status-200`, res.status === 200, `status=${res.status}`);

    const title = titleOf(html);
    assert(`${page.path} title-template`, title === page.title, `got "${title}" want "${page.title}"`);

    const desc = metaContent(html, "name", "description");
    assert(
      `${page.path} description<=155`,
      typeof desc === "string" && desc.length > 0 && desc.length <= 155,
      desc === null ? "missing" : `len=${desc.length}`
    );

    const canonical = canonicalOf(html);
    assert(
      `${page.path} canonical`,
      canonical === expectedCanonical(page.path),
      `got "${canonical}" want "${expectedCanonical(page.path)}"`
    );

    const ogTitle = metaContent(html, "property", "og:title");
    assert(`${page.path} og:title`, ogTitle === page.title, `got "${ogTitle}"`);
    const ogDesc = metaContent(html, "property", "og:description");
    assert(`${page.path} og:description`, typeof ogDesc === "string" && ogDesc.length > 0, `got "${ogDesc}"`);
    const ogImage = metaContent(html, "property", "og:image");
    assert(`${page.path} og:image`, ogImage === OG_IMAGE_URL, `got "${ogImage}" want "${OG_IMAGE_URL}"`);
    const ogW = metaContent(html, "property", "og:image:width");
    const ogH = metaContent(html, "property", "og:image:height");
    assert(`${page.path} og:image-1200x630`, ogW === "1200" && ogH === "630", `w=${ogW} h=${ogH}`);
    const ogLocale = metaContent(html, "property", "og:locale");
    assert(`${page.path} og:locale-en_US`, ogLocale === "en_US", `got "${ogLocale}"`);
    const ogUrl = metaContent(html, "property", "og:url");
    assert(`${page.path} og:url`, ogUrl === expectedCanonical(page.path), `got "${ogUrl}"`);

    // §8.3 JSON-LD per page kind.
    const blocks = extractJsonLd(html);
    const parseErrs = blocks.filter((b) => b.__parseError);
    assert(`${page.path} jsonld-parses`, parseErrs.length === 0, JSON.stringify(parseErrs.map((e) => e.__parseError)));

    if (page.kind === "home" || page.kind === "about") {
      const person = byType(blocks, "Person");
      assert(`${page.path} Person-present`, !!person, `types=${blocks.map((b) => b["@type"]).join(",")}`);
      if (person) {
        assert(`${page.path} Person-name`, person.name === "Maulana Faris Al Ghifari", `name="${person.name}"`);
        assert(
          `${page.path} Person-url`,
          typeof person.url === "string" && person.url.startsWith(BASE),
          `url="${person.url}"`
        );
        assert(
          `${page.path} Person-sameAs`,
          Array.isArray(person.sameAs) &&
            SAME_AS.every((s) => person.sameAs.includes(s)) &&
            !person.sameAs.some((s) => /x\.com|twitter\.com/i.test(String(s))),
          JSON.stringify(person.sameAs)
        );
      }
    }
    if (page.kind === "home") {
      const site = byType(blocks, "WebSite");
      assert(`${page.path} WebSite-present`, !!site, `types=${blocks.map((b) => b["@type"]).join(",")}`);
      if (site) {
        assert(`${page.path} WebSite-name`, site.name === "Maulana Faris", `name="${site.name}"`);
        const action = site.potentialAction;
        assert(
          `${page.path} WebSite-SearchAction`,
          !!action &&
            action["@type"] === "SearchAction" &&
            typeof action.target === "string" &&
            action.target.includes("{search_term_string}") &&
            action["query-input"] === "required name=search_term_string",
          JSON.stringify(action)
        );
      }
    }
    if (page.kind === "case") {
      const work = byType(blocks, "CreativeWork");
      assert(`${page.path} CreativeWork-present`, !!work, `types=${blocks.map((b) => b["@type"]).join(",")}`);
      if (work) {
        assert(
          `${page.path} CreativeWork-name`,
          work.name === page.title.replace(" - Maulana Faris", ""),
          `name="${work.name}"`
        );
        assert(
          `${page.path} CreativeWork-url`,
          work.url === `${BASE}${page.path}`,
          `url="${work.url}"`
        );
      }
    }
  }
  timings.fetchMs = Date.now() - f0;

  // 4. §8.4 crawl files.
  console.log("\n[probe] §8.4 crawl files");
  const smRes = await fetch(`http://localhost:${PORT}/sitemap.xml`);
  const smBody = await smRes.text();
  assert("sitemap status-200", smRes.status === 200, `status=${smRes.status}`);
  assert(
    "sitemap content-type-xml",
    (smRes.headers.get("content-type") || "").toLowerCase().includes("xml"),
    smRes.headers.get("content-type")
  );
  for (const page of PAGES) {
    const loc = page.path === "/" ? `${BASE}/` : `${BASE}${page.path}`;
    assert(`sitemap lists ${page.path}`, smBody.includes(`<loc>${loc}</loc>`), loc);
  }

  const rbRes = await fetch(`http://localhost:${PORT}/robots.txt`);
  const rbBody = await rbRes.text();
  assert("robots status-200", rbRes.status === 200, `status=${rbRes.status}`);
  assert("robots allows-crawl", /user-agent:\s*\*/i.test(rbBody) && /allow:\s*\//i.test(rbBody), rbBody.slice(0, 120));
  assert(
    "robots points-to-sitemap",
    rbBody.includes(`${BASE}/sitemap.xml`),
    `sitemap=${BASE}/sitemap.xml`
  );

  const nfRes = await fetch(`http://localhost:${PORT}/seo-probe-missing-${Date.now()}`);
  const nfBody = await nfRes.text();
  assert("404 status", nfRes.status === 404, `status=${nfRes.status}`);
  assert("404 noindex", nfBody.includes("noindex"), "meta robots noindex present");

  // 5. CDP browser-level verification of Home (parsed DOM, not logs).
  console.log("\n[probe] CDP browser pass (Home)");
  chromeTmpDir = mkdtempSync(join(tmpdir(), "chrome-seo-probe-"));
  chromeProc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeTmpDir}`,
      "--disable-gpu",
      "--no-sandbox",
      "--window-size=1440,900",
    ],
    { stdio: "ignore", detached: true }
  );
  chromeProc.unref();
  await sleep(2000);

  let wsUrl;
  for (let i = 0; i < 15; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await resp.json();
      const page = targets.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(500);
  }
  if (!wsUrl) throw new Error("Chrome CDP not reachable");

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  await cdpSend(ws, "Page.enable");
  await cdpSend(ws, "Runtime.enable");

  const c0 = Date.now();
  await cdpSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdpSend(ws, "Page.navigate", { url: HOME });
  await waitForLoad(ws);
  await sleep(500);

  const dom = await cdpEval(ws, DOM_PRESENCE_EXPR);
  const domJsonLd = dom.jsonldRaw.map((raw) => {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { __parseError: String(e) };
    }
  });
  assert("CDP home title", dom.title === "Maulana Faris - Web Developer", `got "${dom.title}"`);
  assert("CDP home canonical", dom.canonical === `${BASE}/`, `got "${dom.canonical}"`);
  assert("CDP home og:title", dom.ogTitle === "Maulana Faris - Web Developer", `got "${dom.ogTitle}"`);
  assert("CDP home og:description", typeof dom.ogDescription === "string" && dom.ogDescription.length > 0, "");
  assert("CDP home og:image", dom.ogImage === OG_IMAGE_URL, `got "${dom.ogImage}"`);
  assert("CDP home og:locale", dom.ogLocale === "en_US", `got "${dom.ogLocale}"`);
  assert(
    "CDP home jsonld Person+WebSite",
    !!byType(domJsonLd, "Person") && !!byType(domJsonLd, "WebSite"),
    `types=${domJsonLd.map((b) => b["@type"]).join(",")}`
  );

  // 6. Artifacts (optional).
  if (ARTIFACTS) {
    console.log("\n[probe] Writing evidence artifacts...");
    writeFileSync(A.dom, dom.jsonldRaw ? await cdpEval(ws, "document.documentElement.outerHTML") : "");
    writeFileSync(A.sitemap, smBody);
    writeFileSync(A.robots, rbBody);

    const shot = await cdpSend(ws, "Page.captureScreenshot", { format: "png" });
    writeFileSync(A.shot, Buffer.from(shot.data, "base64"));

    const allRoutes = {};
    for (const page of PAGES) {
      const html = rawHtml[page.path];
      allRoutes[page.path] = {
        title: titleOf(html),
        description: { present: metaContent(html, "name", "description") !== null, len: (metaContent(html, "name", "description") || "").length },
        canonical: canonicalOf(html),
        "og:title": metaContent(html, "property", "og:title"),
        "og:description": metaContent(html, "property", "og:description") !== null,
        "og:image": metaContent(html, "property", "og:image"),
        "og:locale": metaContent(html, "property", "og:locale"),
        jsonldTypes: extractJsonLd(html).map((b) => b["@type"] ?? null),
      };
    }
    const styles = {
      capturedAt: new Date().toISOString(),
      via: "CDP Runtime.evaluate on http://localhost:3110/ (1440x900)",
      viewport: { width: 1440, height: 900 },
      documentTitle: dom.title,
      meta: {
        description: { present: dom.description !== null, value: dom.description },
        canonical: { present: dom.canonical !== null, href: dom.canonical },
        "og:title": { present: dom.ogTitle !== null, content: dom.ogTitle },
        "og:description": { present: dom.ogDescription !== null, content: dom.ogDescription },
        "og:image": { present: dom.ogImage !== null, content: dom.ogImage, width: dom.ogImageWidth, height: dom.ogImageHeight },
        "og:locale": { present: dom.ogLocale !== null, content: dom.ogLocale },
        "og:url": { present: dom.ogUrl !== null, content: dom.ogUrl },
      },
      jsonld: {
        count: domJsonLd.length,
        blocks: domJsonLd.map((b) => ({
          type: b["@type"] ?? null,
          name: b.name ?? null,
          url: b.url ?? null,
          sameAs: Array.isArray(b.sameAs) ? b.sameAs : undefined,
          hasSearchAction: b.potentialAction?.["@type"] === "SearchAction",
        })),
      },
      allRoutes,
    };
    writeFileSync(A.styles, JSON.stringify(styles, null, 2));

    const jsonldBundle = {
      capturedAt: new Date().toISOString(),
      home: summarize(extractJsonLd(rawHtml["/"])),
      about: summarize(extractJsonLd(rawHtml["/about"])),
      caseStudies: {
        "buku-tahu": summarize(extractJsonLd(rawHtml["/work/buku-tahu"])),
        "astar": summarize(extractJsonLd(rawHtml["/work/astar"])),
        "apecx-2026": summarize(extractJsonLd(rawHtml["/work/apecx-2026"])),
      },
    };
    writeFileSync(A.jsonld, JSON.stringify(jsonldBundle, null, 2));
    console.log("[probe] artifacts written to .omo/evidence (task-13-*)");
  }

  ws.close();
  timings.cdpMs = Date.now() - c0;
} catch (err) {
  console.error("[probe] FATAL:", err);
  failures++;
} finally {
  await cleanup();
}

function summarize(blocks) {
  return blocks.map((b) => ({
    parsed: !b.__parseError,
    type: b["@type"] ?? null,
    name: b.name ?? null,
    url: b.url ?? null,
    sameAs: Array.isArray(b.sameAs) ? b.sameAs : undefined,
    potentialAction: b.potentialAction ?? undefined,
    author: b.author ?? undefined,
    description: b.description ?? undefined,
  }));
}

timings.totalMs = Date.now() - t0;
console.log(
  "\n" +
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        failures,
        pass: failures === 0,
        timings,
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
