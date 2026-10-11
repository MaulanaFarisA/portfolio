/**
 * run-logo-qa.mjs - headless verification runner for the PixelLogo work.
 *
 * A. Runs Temp\opencode\logo-test.html twice via Chrome --dump-dom; dumps go
 *    to .omo\evidence\task-3-qa-run{1,2}.html; parses <pre id="qa-result">;
 *    asserts both runs PASS and produce identical JSON (flaky-test check).
 * B. Captures evidence screenshots into .omo\evidence\ (logo at 24/48/96px,
 *    200% zoom render, favicon-512 copy) and verifies every PNG's exact
 *    dimensions from its IHDR chunk.
 *
 * Exits non-zero on any failure. Zero deps.
 * Run: node scripts/run-logo-qa.mjs
 */
import { writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TEMP = "C:\\Users\\FARIS\\AppData\\Local\\Temp\\opencode";
const PROFILE = TEMP + "\\chrome-profile-t3";
const EVIDENCE = "C:\\Users\\FARIS\\.omo\\evidence";
const PUBLIC_DIR = "C:\\Users\\FARIS\\portfolio\\public";
const QA_PAGE = "file:///" + (TEMP + "\\logo-test.html").replace(/\\/g, "/");
const SHOT_PAGE = "file:///" + (TEMP + "\\logo-evidence.html").replace(/\\/g, "/");

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}

function chromeDumpDom(url) {
  const t0 = Date.now();
  const dom = execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--user-data-dir=" + PROFILE,
      "--virtual-time-budget=5000",
      "--dump-dom",
      url,
    ],
    { timeout: 120000, encoding: "utf-8", windowsHide: true }
  );
  return { dom, ms: Date.now() - t0 };
}

function parseQa(dom) {
  const m = dom.match(/<pre id="qa-result">([^<]*)<\/pre>/);
  if (!m) fail("qa-result <pre> not found in DOM dump");
  return JSON.parse(m[1]);
}

function assertPass(label, j) {
  const problems = [];
  if (j.status !== "done") problems.push("status=" + j.status);
  if (j.exact24 !== true) problems.push("exact24=" + j.exact24);
  if (j.blockUniform48 !== true) problems.push("blockUniform48=" + j.blockUniform48);
  if (j.nonUniformBlocks !== 0) problems.push("nonUniformBlocks=" + j.nonUniformBlocks);
  if (j.blockExact48 !== true) problems.push("blockExact48=" + j.blockExact48);
  if (j.blockUniform96 !== true) problems.push("blockUniform96=" + j.blockUniform96);
  if (j.recolorWorks !== true) problems.push("recolorWorks=" + j.recolorWorks);
  if (problems.length) fail(label + " NOT PASSING: " + problems.join(", "));
}

function screenshot(name, size, dsf) {
  const out = EVIDENCE + "\\" + name;
  const t0 = Date.now();
  try {
    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--user-data-dir=" + PROFILE,
        "--force-device-scale-factor=" + dsf,
        "--default-background-color=00000000",
        "--screenshot=" + out,
        "--window-size=" + size + "," + size,
        SHOT_PAGE + "?size=" + size,
      ],
      { timeout: 60000, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch (e) {
    fail(name + ": chrome failed — " + e.message);
  }
  return { name, ms: Date.now() - t0 };
}

function readIhdr(p) {
  const b = readFileSync(p);
  if (b.length < 29) fail(p + ": too small for PNG IHDR");
  if (b.subarray(12, 16).toString("ascii") !== "IHDR") fail(p + ": first chunk not IHDR");
  return {
    w: b.readUInt32BE(16),
    h: b.readUInt32BE(20),
    bytes: b.length,
    sha: createHash("sha256").update(b).digest("hex"),
  };
}

console.log("=== run-logo-qa.mjs ===");
const T0 = Date.now();

console.log("\n-- A. QA harness double-run (flaky check) --");
const run1 = chromeDumpDom(QA_PAGE);
writeFileSync(EVIDENCE + "\\task-3-qa-run1.html", run1.dom, "utf-8");
const j1 = parseQa(run1.dom);
assertPass("run1", j1);
console.log(`run1 PASS (${run1.ms}ms, dump ${run1.dom.length} bytes):`);
console.log("  " + JSON.stringify(j1));

const run2 = chromeDumpDom(QA_PAGE);
writeFileSync(EVIDENCE + "\\task-3-qa-run2.html", run2.dom, "utf-8");
const j2 = parseQa(run2.dom);
assertPass("run2", j2);
console.log(`run2 PASS (${run2.ms}ms, dump ${run2.dom.length} bytes):`);
console.log("  " + JSON.stringify(j2));

if (JSON.stringify(j1) !== JSON.stringify(j2)) fail("run1 vs run2 qa-result JSON differ");
console.log("FLAKY CHECK: PASS — run1 and run2 qa-result JSON are identical");

console.log("\n-- B. Evidence screenshots --");
const shots = [
  screenshot("task-3-logo-24.png", 24, 1),
  screenshot("task-3-logo-48.png", 48, 1),
  screenshot("task-3-logo-96.png", 96, 1),
  screenshot("task-3-logo-24-zoom2x.png", 24, 2),
];
for (const s of shots) console.log(`  ${s.name} captured (${s.ms}ms)`);

copyFileSync(PUBLIC_DIR + "\\icon-512.png", EVIDENCE + "\\task-3-favicon-512.png");
console.log("  task-3-favicon-512.png = byte copy of public/icon-512.png");

const expected = [
  ["task-3-logo-24.png", 24, 24],
  ["task-3-logo-48.png", 48, 48],
  ["task-3-logo-96.png", 96, 96],
  ["task-3-logo-24-zoom2x.png", 48, 48],
  ["task-3-favicon-512.png", 512, 512],
];
console.log("\n-- Evidence PNG IHDR verification --");
let allOk = true;
for (const [name, ew, eh] of expected) {
  const ih = readIhdr(EVIDENCE + "\\" + name);
  const ok = ih.w === ew && ih.h === eh;
  if (!ok) allOk = false;
  console.log(
    `  ${name.padEnd(28)} ${ih.w}x${ih.h}  bytes=${String(ih.bytes).padEnd(6)} sha256=${ih.sha.slice(0, 16)}  ${ok ? "OK" : "MISMATCH (expected " + ew + "x" + eh + ")"}`
  );
}
if (!allOk) fail("evidence screenshot dimension mismatch");

console.log(`\n=== run-logo-qa.mjs OK — total ${Date.now() - T0}ms — exit 0 ===`);
