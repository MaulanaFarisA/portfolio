/**
 * check-png-alpha.mjs - verifies PNG background transparency by decoding
 * real pixels in headless Chrome (canvas), not by trusting generator logs.
 *
 * Usage: node scripts/check-png-alpha.mjs <file.png> [more.png ...]
 * Emits JSON to stdout: per file width/height, corner pixels, center pixel,
 * and transparent/opaque/partial pixel counts.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";

const TEMP_DIR = "C:\\Users\\FARIS\\AppData\\Local\\Temp\\opencode";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_DIR = "C:\\Users\\FARIS\\AppData\\Local\\Temp\\opencode\\chrome-profile-t3";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/check-png-alpha.mjs <file.png> [...]");
  process.exit(1);
}

const entries = files.map((f) => {
  const abs = resolve(f);
  return { name: basename(abs), b64: readFileSync(abs).toString("base64") };
});

const pageJs = [
  "var FILES = " + JSON.stringify(entries) + ";",
  "var out = { status: 'started', files: {} };",
  "var idx = 0;",
  "function done(st) {",
  "  if (idx >= FILES.length) out.status = 'done';",
  "  else if (out.status === 'started') out.status = st || 'done';",
  "  document.getElementById('alpha-result').textContent = JSON.stringify(out);",
  "}",
  "function next() {",
  "  if (idx >= FILES.length) { done(); return; }",
  "  var f = FILES[idx++];",
  "  var img = new Image();",
  "  img.onload = function () {",
  "    var c = document.createElement('canvas');",
  "    c.width = img.width; c.height = img.height;",
  "    var ctx = c.getContext('2d');",
  "    ctx.drawImage(img, 0, 0);",
  "    var d = ctx.getImageData(0, 0, c.width, c.height).data;",
  "    var transparent = 0, opaque = 0, partial = 0;",
  "    var seen = {}; var distinct = 0;",
  "    var key = { accent: false, frame: false, highlight: false, shadow: false, canvasBg: false };",
  "    for (var i = 0; i < d.length; i += 4) {",
  "      if (d[i+3] === 0) transparent++;",
  "      else if (d[i+3] === 255) opaque++;",
  "      else partial++;",
  "      var k = d[i] + ',' + d[i+1] + ',' + d[i+2] + ',' + d[i+3];",
  "      if (!seen[k]) { seen[k] = 1; distinct++; }",
  "      if (d[i+3] === 255) {",
  "        if (d[i] === 245 && d[i+1] === 158 && d[i+2] === 11) key.accent = true;",
  "        if (d[i] === 61 && d[i+1] === 67 && d[i+2] === 76) key.frame = true;",
  "        if (d[i] === 242 && d[i+1] === 244 && d[i+2] === 247) key.highlight = true;",
  "        if (d[i] === 8 && d[i+1] === 9 && d[i+2] === 10) key.shadow = true;",
  "        if (d[i] === 12 && d[i+1] === 13 && d[i+2] === 14) key.canvasBg = true;",
  "      }",
  "    }",
  "    function px(x, y) { var i = (y * c.width + x) * 4; return [d[i], d[i+1], d[i+2], d[i+3]]; }",
  "    out.files[f.name] = {",
  "      width: c.width, height: c.height,",
  "      cornerTL: px(0, 0), cornerTR: px(c.width - 1, 0),",
  "      cornerBL: px(0, c.height - 1), cornerBR: px(c.width - 1, c.height - 1),",
  "      center: px(Math.floor(c.width / 2), Math.floor(c.height / 2)),",
  "      transparentPixels: transparent, opaquePixels: opaque, partialPixels: partial,",
  "      distinctColors: distinct,",
  "      hasAccent: key.accent, hasFrame: key.frame, hasHighlight: key.highlight,",
  "      hasShadow: key.shadow, hasCanvasBg: key.canvasBg",
  "    };",
  "    next();",
  "  };",
  "  img.onerror = function () { out.files[f.name] = { error: true }; next(); };",
  "  img.src = 'data:image/png;base64,' + f.b64;",
  "}",
  "next();",
  "setTimeout(function () { done('timeout-partial'); }, 8000);",
].join("\n");

const html =
  '<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n' +
  '<pre id="alpha-result">PENDING</pre>\n<script>\n' + pageJs + "\n</script>\n</body></html>\n";

mkdirSync(TEMP_DIR, { recursive: true });
const htmlPath = TEMP_DIR + "\\logo-alpha.html";
writeFileSync(htmlPath, html, "utf-8");

const t0 = Date.now();
const dom = execFileSync(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--virtual-time-budget=10000",
    `--user-data-dir=${PROFILE_DIR}`,
    "--dump-dom",
    "file:///" + htmlPath.replace(/\\/g, "/"),
  ],
  { timeout: 90000, encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
);
const dur = Date.now() - t0;

const m = dom.match(/<pre id="alpha-result">([^<]*)<\/pre>/);
if (!m) {
  console.error("alpha-result not found in DOM dump");
  process.exit(1);
}
const json = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
json.chromeMs = dur;
console.log(JSON.stringify(json, null, 2));
