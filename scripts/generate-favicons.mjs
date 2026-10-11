/**
 * generate-favicons.mjs — re-runnable favicon generator. Zero new deps.
 *
 * Source of truth: src/lib/logo-geometry.json (24x24 matrix).
 * Outputs (public/):
 *   favicon.svg              — static SVG, §2.1 dark hexes, transparent bg
 *   favicon-16.png           — transparent
 *   favicon-32.png           — transparent
 *   apple-touch-icon-180.png — solid #0C0D0E canvas (see note below)
 *   icon-192.png             — transparent
 *   icon-512.png             — transparent
 *
 * Why apple-touch-icon is solid: iOS composites touch icons over the
 * springboard wallpaper when the icon has transparency, making the frame
 * unreadable; a solid --surface-canvas (#0C0D0E) backing is the
 * conventional fix. All other PNGs are transparent — per design.md §4.5
 * the SVG favicon ships first and PNGs are fallbacks.
 *
 * PNGs are rasterized by SYSTEM Chrome (headless=new) from a temp HTML
 * that embeds the SAME geometry JSON (no hand-copied matrix). Each PNG's
 * exact dimensions are verified by parsing the IHDR chunk; the script
 * exits non-zero on any mismatch. A manifest table (bytes + sha256) is
 * printed for the evidence file.
 *
 * Usage: node scripts/generate-favicons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const GEOMETRY_PATH = join(ROOT, "src", "lib", "logo-geometry.json");
const PUBLIC_DIR = join(ROOT, "public");
const TEMP_DIR = "C:\\Users\\FARIS\\AppData\\Local\\Temp\\opencode";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// Isolated profile so headless runs never attach to a user's live Chrome
// session; also makes "which chrome processes are mine" unambiguous.
const PROFILE_DIR = join(TEMP_DIR, "chrome-profile-t3");

// §2.1 dark tokens — static files cannot rely on CSS custom properties.
const HEX_PALETTE = { F: "#3D434C", H: "#F2F4F7", S: "#08090A", A: "#F59E0B" };

// [filename, size, solidBackground]
const SIZES = [
  ["favicon-16.png", 16, false],
  ["favicon-32.png", 32, false],
  ["apple-touch-icon-180.png", 180, true],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
];

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ── 0. Load + validate geometry (fail fast on malformed input) ──
if (!existsSync(GEOMETRY_PATH)) fail("geometry missing: " + GEOMETRY_PATH);
const geometry = JSON.parse(readFileSync(GEOMETRY_PATH, "utf-8"));
if (geometry.size !== 24) fail("geometry.size must be 24, got " + geometry.size);
if (!Array.isArray(geometry.rows) || geometry.rows.length !== 24)
  fail("geometry.rows must contain 24 rows");
geometry.rows.forEach((row, y) => {
  if (row.length !== 24) fail(`row ${y} has length ${row.length}, expected 24`);
  for (const ch of row) if (!".FHSA".includes(ch)) fail(`unknown matrix char '${ch}' in row ${y}`);
});
for (const ch of "FHSA") if (!geometry.palette[ch]) fail("palette missing key " + ch);
console.log("geometry OK: 24x24, palette keys F/H/S/A");

// ── SVG builder: run-length merge horizontal runs (small DOM) ──
function buildSvgRects(pal) {
  const lines = [];
  for (let y = 0; y < geometry.rows.length; y++) {
    const row = geometry.rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === ".") {
        x++;
        continue;
      }
      const fill = pal[ch];
      if (!fill) fail(`no fill for '${ch}'`);
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      lines.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fill}"/>`);
      x = end;
    }
  }
  return lines.join("\n    ");
}

// ── 1. public/favicon.svg ──
function writeFaviconSvg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">\n    ${buildSvgRects(
    HEX_PALETTE
  )}\n</svg>\n`;
  if (svg.includes("<text")) fail("favicon.svg must not contain text");
  if (!svg.includes('shape-rendering="crispEdges"')) fail("favicon.svg missing crispEdges");
  if (!svg.includes('viewBox="0 0 24 24"')) fail("favicon.svg missing viewBox");
  const p = join(PUBLIC_DIR, "favicon.svg");
  writeFileSync(p, svg, "utf-8");
  const buf = readFileSync(p);
  console.log(`[1/3] public/favicon.svg written — ${buf.length} bytes, sha256=${sha256(buf)}`);
}

// ── 2. temp HTML (reused for every size; reads ?size= and ?bg=) ──
function writeTempHtml() {
  mkdirSync(TEMP_DIR, { recursive: true });
  const rects = buildSvgRects(HEX_PALETTE);
  // Two separate script tags: a failure in the render script can never
  // suppress the background paint. rects is JSON.stringify'd so its
  // newlines are escaped inside the JS string literal (a raw newline in a
  // single-quoted literal is a SyntaxError and would blank the page).
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{overflow:hidden}
svg{display:block}
</style></head><body><script>
var bgParams=new URLSearchParams(location.search);
if(bgParams.get('bg'))document.body.style.background=bgParams.get('bg');
</script><script>
var s=parseInt(new URLSearchParams(location.search).get('size')||'24',10);
var rects=${JSON.stringify(rects)};
document.body.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="'+s+'" height="'+s+'" shape-rendering="crispEdges">'+rects+'</svg>';
</script></body></html>`;
  const tempPath = join(TEMP_DIR, "logo-favicon.html");
  writeFileSync(tempPath, html, "utf-8");
  console.log(`[2/3] temp HTML written — ${tempPath}`);
  return tempPath;
}

// ── 3. Chrome screenshots ──
function screenshotAll(tempHtmlPath) {
  for (const [filename, size, solid] of SIZES) {
    const outPath = join(PUBLIC_DIR, filename);
    const url =
      `file:///${tempHtmlPath.replace(/\\/g, "/")}?size=${size}` +
      (solid ? "&bg=%230C0D0E" : "");
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--user-data-dir=${PROFILE_DIR}`,
      // screenshot pixels == CSS px, so IHDR dims are exactly SxS
      "--force-device-scale-factor=1",
      // Chrome parses this switch as RRGGBBAA (observed empirically:
      // FF0C0D0E produced #FF0C0D). Apple icon gets opaque canvas #0C0D0E;
      // everything else transparent. The page also paints body background
      // from ?bg= as a second, script-level guarantee.
      solid ? "--default-background-color=0C0D0EFF" : "--default-background-color=00000000",
      `--screenshot=${outPath}`,
      `--window-size=${size},${size}`,
      url,
    ];
    const t0 = Date.now();
    try {
      execFileSync(CHROME, args, {
        timeout: 60000,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      fail(`${filename}: chrome exited non-zero — ${e.message}`);
    }
    console.log(
      `      ${filename.padEnd(26)} ${size}x${size}  exit=0  ${Date.now() - t0}ms`
    );
  }
}

// ── 4. IHDR verification + manifest ──
function readIhdr(p) {
  const buf = readFileSync(p);
  if (buf.length < 29) fail(p + ": too small for PNG IHDR");
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) fail(p + ": bad PNG signature");
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") fail(p + ": first chunk not IHDR");
  return {
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
    colorType: buf[25], // 6 = RGBA
    bytes: buf.length,
    sha: sha256(buf),
  };
}

function verifyAll() {
  console.log("\n── MANIFEST (dims parsed from IHDR bytes 16..23) ──");
  console.log(
    "file                        req     actual   type  bytes  sha256[:16]       status"
  );
  let ok = true;
  for (const [filename, size] of SIZES) {
    const p = join(PUBLIC_DIR, filename);
    if (!existsSync(p)) fail(filename + " missing after generation");
    const ih = readIhdr(p);
    const good = ih.w === size && ih.h === size;
    if (!good) ok = false;
    console.log(
      `${filename.padEnd(27)} ${String(size).padEnd(7)} ${(ih.w + "x" + ih.h).padEnd(
        8
      )} ${String(ih.colorType).padEnd(5)} ${String(ih.bytes).padEnd(6)} ${ih.sha
        .slice(0, 16)
        .padEnd(16)}  ${good ? "OK" : "MISMATCH"}`
    );
  }
  if (!ok) fail("PNG dimension mismatch — see manifest above");
  const svgPath = join(PUBLIC_DIR, "favicon.svg");
  if (!existsSync(svgPath)) fail("favicon.svg missing");
  const svgBuf = readFileSync(svgPath);
  console.log(
    `${"favicon.svg".padEnd(27)} svg     —        —     ${String(svgBuf.length).padEnd(
      6
    )} ${sha256(svgBuf).slice(0, 16).padEnd(16)}  OK`
  );
  console.log("✓ ALL 6 FAVICON FILES VERIFIED (exact dimensions)");
}

// ── main ──
console.log("=== generate-favicons.mjs ===");
const t0 = Date.now();
if (!existsSync(CHROME)) fail("system Chrome not found at " + CHROME);
writeFaviconSvg();
const tempHtml = writeTempHtml();
screenshotAll(tempHtml);
verifyAll();
console.log(`=== GENERATOR OK — total ${Date.now() - t0}ms — exit 0 ===`);
