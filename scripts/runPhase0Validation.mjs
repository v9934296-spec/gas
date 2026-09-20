import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizePhase0Validation } from "../src/phase0Validation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.resolve(__dirname, "../validation/fixtures");

async function readFixture(name) {
  const filePath = path.join(fixtureDir, name);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

const fixtures = {
  cleanStt: await readFixture("clean-stt.json"),
  phoneStt: await readFixture("phone-stt.json"),
  silence: await readFixture("silence-no-bars.json"),
  rhyme: await readFixture("rhyme-precision.json"),
  timing: await readFixture("timing-agreement.json"),
};

const report = summarizePhase0Validation(fixtures);
const gateLines = Object.entries(report.gates).map(([name, gate]) => {
  const status = gate.pass ? "PASS" : "FAIL";
  return `${status} ${name}: actual=${gate.actual} threshold=${gate.threshold}`;
});

console.log("BARZ PHASE 0 TRUST GATES");
console.log(gateLines.join("\n"));
console.log(JSON.stringify(report, null, 2));

if (!report.launchReady) {
  process.exitCode = 1;
}
