/**
 * verify-pixel-logo-render.mjs - renders the REAL src/components/PixelLogo.tsx
 * through react-dom/server (TSX transpiled with the project's own TypeScript)
 * and asserts the markup matches the geometry JSON exactly. Proves the
 * component (not just the harness) renders correct, accessible SVG.
 *
 * Run: node scripts/verify-pixel-logo-render.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const req = createRequire(join(ROOT, "package.json"));

const ts = req("typescript");
const React = req("react");
const ReactDOMServer = req("react-dom/server");

const src = readFileSync(join(ROOT, "src/components/PixelLogo.tsx"), "utf-8");
const transpiled = ts.transpileModule(src, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});

const geometry = JSON.parse(readFileSync(join(ROOT, "src/lib/logo-geometry.json"), "utf-8"));

const shimRequire = (id) => {
  if (id === "@/lib/logo-geometry.json") return { __esModule: true, default: geometry };
  return req(id);
};
const moduleObj = { exports: {} };
new Function("require", "module", "exports", transpiled.outputText)(
  shimRequire,
  moduleObj,
  moduleObj.exports
);
const PixelLogo = moduleObj.exports.PixelLogo;
if (typeof PixelLogo !== "function") {
  console.error("FAIL: PixelLogo export missing after transpile");
  process.exit(1);
}

const problems = [];
const check = (cond, msg) => {
  if (!cond) problems.push(msg);
};

const html = ReactDOMServer.renderToStaticMarkup(
  React.createElement(PixelLogo, { label: "Neo-Pixel logo", className: "brand-mark" })
);

check(html.includes('role="img"'), "missing role=img");
check(html.includes('aria-label="Neo-Pixel logo"'), "missing/incorrect aria-label");
check(html.includes('class="brand-mark"'), "className not applied");
check(html.includes('viewBox="0 0 24 24"'), "missing viewBox 0 0 24 24");
check(html.includes('width="48"') && html.includes('height="48"'), "default size is not 48");
check(html.includes('shape-rendering="crispEdges"'), "missing shape-rendering crispEdges");
check(html.includes('aria-hidden="true"'), "svg missing aria-hidden");
check(html.includes('focusable="false"'), "svg missing focusable=false");
check(!html.includes("<text"), "text element found inside SVG");
for (const v of ["var(--border-strong)", "var(--text-primary)", "var(--surface-sunken)", "var(--accent-amber)"]) {
  check(html.includes('fill="' + v + '"'), "missing palette var " + v);
}

const rectRe = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="([^"]+)"(?:><\/rect>|\/>)/g;
const gotRects = [];
let m;
while ((m = rectRe.exec(html)) !== null) {
  gotRects.push({ x: +m[1], y: +m[2], width: +m[3], height: +m[4], fill: m[5] });
}

const expectedRects = [];
for (let y = 0; y < geometry.rows.length; y++) {
  const row = geometry.rows[y];
  let x = 0;
  while (x < row.length) {
    const ch = row[x];
    if (ch === ".") {
      x++;
      continue;
    }
    let end = x + 1;
    while (end < row.length && row[end] === ch) end++;
    expectedRects.push({ x, y, width: end - x, height: 1, fill: geometry.palette[ch] });
    x = end;
  }
}

check(gotRects.length === expectedRects.length, `rect count ${gotRects.length} != expected ${expectedRects.length}`);
for (let i = 0; i < Math.min(gotRects.length, expectedRects.length); i++) {
  const a = JSON.stringify(gotRects[i]);
  const b = JSON.stringify(expectedRects[i]);
  if (a !== b) {
    check(false, `rect[${i}] ${a} != ${b}`);
    break;
  }
}

const html24 = ReactDOMServer.renderToStaticMarkup(
  React.createElement(PixelLogo, { label: "x", size: 24 })
);
const html96 = ReactDOMServer.renderToStaticMarkup(
  React.createElement(PixelLogo, { label: "x", size: 96 })
);
check(html24.includes('width="24"') && html24.includes('height="24"'), "size=24 not honored");
check(html96.includes('width="96"') && html96.includes('height="96"'), "size=96 not honored");

if (problems.length) {
  console.error("FAIL:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("PASS: PixelLogo.tsx renders correctly via react-dom/server");
console.log(`  rects rendered: ${gotRects.length} (expected ${expectedRects.length})`);
console.log(`  default size: 48; size=24 and size=96 honored; className, role=img, aria-label, aria-hidden, crispEdges present`);
console.log(`  palette vars present; no <text>; rect list identical to geometry JSON`);
