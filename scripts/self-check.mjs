#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/role-protocol.md",
  "references/runtime-adapters.md",
  "references/failure-modes.md",
  "templates/ROLE-CONTRACT.json",
  "schemas/role-contract.schema.json",
  "scripts/runtime/policy.mjs",
  "scripts/runtime/role-gate.mjs",
  "scripts/runtime/handoff.mjs",
  "scripts/runtime/codex-role-guard.mjs",
  "adapters/codex/hooks.json",
];
const missing = required.filter((relative) => !fs.existsSync(path.join(ROOT, relative)));
if (missing.length) {
  console.error(`MISSING FILES: ${missing.join(", ")}`);
  process.exit(1);
}
for (const relative of [
  "templates/ROLE-CONTRACT.json",
  "templates/WORK-STATE.json",
  "schemas/role-contract.schema.json",
  "schemas/evaluation-request.schema.json",
  "adapters/codex/hooks.json",
]) {
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}
console.log("PACKAGE SELF-CHECK PASS");
