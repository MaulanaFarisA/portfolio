/**
 * generate-qa-harness.mjs - builds the visual QA pages from
 * src/lib/logo-geometry.json (no hand-copied matrix). Zero new deps.
 *
 * Writes into Temp\opencode:
 *   logo-test.html     - on load, draws the logo (built from the geometry
 *                        JSON) to canvases and records JSON in
 *                        <pre id="qa-result">:
 *                        1) exact24: 24px 1:1 draw, every pixel compared
 *                           against the expected matrix (RGB + alpha)
 *                        2) blockUniform48 / nonUniformBlocks: 48px (2x)
 *                           draw, every 2x2 block must be uniform
 *                           (integer-scale / anti-mixel proof) + exact
 *                           color match per block
 *                        3) blockUniform96: same test at 4x
 *                        4) accentDark / accentLight / recolorWorks:
 *                           two inline copies under dark vs light CSS
 *                           variables, getComputedStyle(accent rect).fill
 *   logo-evidence.html - renders the logo at ?size= for screenshots
 *
 * Run: node scripts/generate-qa-harness.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const GEOMETRY_PATH = join(ROOT, "src", "lib", "logo-geometry.json");
const TEMP_DIR = "C:\\Users\\FARIS\\AppData\\Local\\Temp\\opencode";

const DARK_HEX = { F: "#3D434C", H: "#F2F4F7", S: "#08090A", A: "#F59E0B" };
const DARK_RGB = { F: [61, 67, 76], H: [242, 244, 247], S: [8, 9, 10], A: [245, 158, 11] };

const geometry = JSON.parse(readFileSync(GEOMETRY_PATH, "utf-8"));
if (geometry.size !== 24 || geometry.rows.length !== 24) {
  throw new Error("geometry must be a 24x24 matrix");
}
geometry.rows.forEach((row, y) => {
  if (row.length !== 24) throw new Error("row " + y + " length " + row.length + " != 24");
});

function buildRects(pal) {
  const out = [];
  for (let y = 0; y < geometry.rows.length; y++) {
    const row = geometry.rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === ".") { x++; continue; }
      const fill = pal[ch];
      if (!fill) throw new Error("no fill for char " + ch);
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      out.push('<rect x="' + x + '" y="' + y + '" width="' + (end - x) + '" height="1" fill="' + fill + '"/>');
      x = end;
    }
  }
  return out.join("");
}

const hexRects = buildRects(DARK_HEX);
const varRects = buildRects(geometry.palette);
const DATA = { rows: geometry.rows, rgb: DARK_RGB, rects: hexRects };

const pageJs = [
  "var DATA = " + JSON.stringify(DATA) + ";",
  "var out = { status: 'started' };",
  "var finished = false;",
  "function svgFor(size) {",
  "  return '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"' + size + '\" height=\"' + size + '\" shape-rendering=\"crispEdges\">' + DATA.rects + '</svg>';",
  "}",
  "function writeResult() {",
  "  var dr = document.querySelector('#svg-dark rect[fill=\"var(--accent-amber)\"]');",
  "  var lr = document.querySelector('#svg-light rect[fill=\"var(--accent-amber)\"]');",
  "  out.accentDark = dr ? getComputedStyle(dr).fill : '';",
  "  out.accentLight = lr ? getComputedStyle(lr).fill : '';",
  "  out.recolorWorks = !!out.accentDark && !!out.accentLight && out.accentDark !== out.accentLight;",
  "  document.getElementById('qa-result').textContent = JSON.stringify(out);",
  "}",
  "function finish() {",
  "  if (finished) return;",
  "  finished = true;",
  "  if (out.status === 'started' || out.status === 'timeout-partial') out.status = 'done';",
  "  writeResult();",
  "}",
  "function checkPixels(imgData, scale) {",
  "  var d = imgData.data, w = imgData.width;",
  "  var mismatch = 0, nonUniform = 0, first = null;",
  "  for (var by = 0; by < 24; by++) {",
  "    for (var bx = 0; bx < 24; bx++) {",
  "      var ch = DATA.rows[by][bx];",
  "      var uniform = true, exact = true, base = null;",
  "      for (var dy = 0; dy < scale; dy++) {",
  "        for (var dx = 0; dx < scale; dx++) {",
  "          var i = ((by * scale + dy) * w + bx * scale + dx) * 4;",
  "          var px = [d[i], d[i+1], d[i+2], d[i+3]];",
  "          if (!base) { base = px; }",
  "          else if (px[0] !== base[0] || px[1] !== base[1] || px[2] !== base[2] || px[3] !== base[3]) { uniform = false; }",
  "          if (ch === '.') { if (px[3] !== 0) exact = false; }",
  "          else { var e = DATA.rgb[ch]; if (px[0] !== e[0] || px[1] !== e[1] || px[2] !== e[2] || px[3] !== 255) exact = false; }",
  "        }",
  "      }",
  "      if (!uniform) nonUniform++;",
  "      if (!exact) { mismatch++; if (!first) first = { x: bx, y: by, ch: ch, base: base }; }",
  "    }",
  "  }",
  "  return { mismatch: mismatch, nonUniform: nonUniform, first: first };",
  "}",
  "function drawAt(size, cb) {",
  "  var blob = new Blob([svgFor(size)], { type: 'image/svg+xml' });",
  "  var url = URL.createObjectURL(blob);",
  "  var img = new Image();",
  "  img.onload = function () {",
  "    var c = document.createElement('canvas');",
  "    c.width = size; c.height = size;",
  "    var ctx = c.getContext('2d');",
  "    ctx.drawImage(img, 0, 0, size, size);",
  "    URL.revokeObjectURL(url);",
  "    cb(ctx.getImageData(0, 0, size, size));",
  "  };",
  "  img.onerror = function () { out.status = 'img-error@' + size; finish(); };",
  "  img.src = url;",
  "}",
  "setTimeout(function () { if (!finished) { out.status = 'timeout-partial'; writeResult(); } }, 3000);",
  "drawAt(24, function (i24) {",
  "  var r24 = checkPixels(i24, 1);",
  "  out.exact24 = r24.mismatch === 0;",
  "  out.mismatchCount24 = r24.mismatch;",
  "  if (r24.first) out.firstMismatch24 = r24.first;",
  "  drawAt(48, function (i48) {",
  "    var r48 = checkPixels(i48, 2);",
  "    out.blockUniform48 = r48.nonUniform === 0;",
  "    out.nonUniformBlocks = r48.nonUniform;",
  "    out.blockExact48 = r48.mismatch === 0;",
  "    out.blockMismatch48 = r48.mismatch;",
  "    if (r48.first) out.firstBlockMismatch48 = r48.first;",
  "    drawAt(96, function (i96) {",
  "      var r96 = checkPixels(i96, 4);",
  "      out.blockUniform96 = r96.nonUniform === 0;",
  "      out.nonUniformBlocks96 = r96.nonUniform;",
  "      finish();",
  "    });",
  "  });",
  "});",
].join("\n");

const qaHtml =
  '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>PixelLogo QA</title></head><body>\n' +
  '<div id="dark" style="--border-strong:#3D434C;--text-primary:#F2F4F7;--accent-amber:#F59E0B;--surface-sunken:#08090A;display:inline-block">\n' +
  '<svg id="svg-dark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" shape-rendering="crispEdges">' + varRects + "</svg></div>\n" +
  '<div id="light" style="--border-strong:#262422;--text-primary:#1A1918;--accent-amber:#D97706;--surface-sunken:#EFECE4;display:inline-block">\n' +
  '<svg id="svg-light" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" shape-rendering="crispEdges">' + varRects + "</svg></div>\n" +
  '<pre id="qa-result">PENDING</pre>\n<script>\n' + pageJs + "\n</script>\n</body></html>\n";

const evidenceHtml =
  '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><style>\n' +
  "*{margin:0;padding:0;box-sizing:border-box}body{background:#0C0D0E;overflow:hidden}svg{display:block}\n" +
  '</style></head><body><script>\n' +
  "var s = parseInt(new URLSearchParams(location.search).get('size') || '24', 10);\n" +
  "document.body.innerHTML = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"' + s + '\" height=\"' + s + '\" shape-rendering=\"crispEdges\">' + " + JSON.stringify(hexRects) + " + '</svg>';\n" +
  "</script></body></html>\n";

mkdirSync(TEMP_DIR, { recursive: true });
writeFileSync(join(TEMP_DIR, "logo-test.html"), qaHtml, "utf-8");
writeFileSync(join(TEMP_DIR, "logo-evidence.html"), evidenceHtml, "utf-8");
console.log("OK logo-test.html (" + qaHtml.length + " bytes) + logo-evidence.html (" + evidenceHtml.length + " bytes) written from geometry JSON");
