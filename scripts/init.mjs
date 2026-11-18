#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendJsonLine,
  gitText,
  nowIso,
  readJson,
  readText,
  resolveRepoPath,
  todayCompact,
  writeJsonAtomic,
  writeTextAtomic,
} from "./runtime/common.mjs";
import { validateContractRuntime } from "./runtime/policy.mjs";
import { writeResume } from "./runtime/summarize.mjs";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { root: null, directorThreadId: null, adapters: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = path.resolve(argv[++index]);
    else if (arg === "--director-thread-id") options.directorThreadId = argv[++index];
    else if (arg === "--adapter") options.adapters.push(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: init.mjs --root <repo> --director-thread-id <id> [--adapter codex]");
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.root) throw new Error("--root is required");
  if (!options.directorThreadId) throw new Error("--director-thread-id is required");
  for (const adapter of options.adapters) {
    if (!["codex", "generic"].includes(adapter)) throw new Error(`unsupported adapter: ${adapter}`);
  }
  return options;
}

function substitute(text, values) {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(key, String(value)),
    text,
  );
}

function copyRuntime(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const filename of [
    "common.mjs",
    "policy.mjs",
    "state.mjs",
    "summarize.mjs",
    "handoff.mjs",
    "evidence-read.mjs",
    "role-gate.mjs",
  ]) {
    fs.copyFileSync(
      path.join(SKILL_ROOT, "scripts/runtime", filename),
      path.join(targetDir, filename),
    );
  }
}

function copyCodexAdapter(targetDir, packageRoot) {
  fs.copyFileSync(
    path.join(SKILL_ROOT, "scripts/runtime/codex-role-guard.mjs"),
    path.join(targetDir, "codex-role-guard.mjs"),
  );
  const hooks = readJson(path.join(SKILL_ROOT, "adapters/codex/hooks.json"));
  const hooksPath = path.join(packageRoot, ".codex/hooks.json");
  if (fs.existsSync(hooksPath)) {
    throw new Error(`${hooksPath} already exists; merge the adapter manually or rerun after removing it`);
  }
  writeJsonAtomic(hooksPath, hooks);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`root does not exist: ${root}`);
  const configPath = path.join(root, ".director-role-firewall.json");
  if (fs.existsSync(configPath)) {
    throw new Error(`${configPath} already exists; use the migration path instead of overwriting role history`);
  }

  const now = nowIso();
  const branch = gitText(root, ["branch", "--show-current"]) || "unversioned";
  const head = gitText(root, ["rev-parse", "HEAD"]) || "unversioned";
  const baseSha = head;
  const config = readJson(path.join(SKILL_ROOT, "templates/config.json"));
  const roleContractText = substitute(
    readText(path.join(SKILL_ROOT, "templates/ROLE-CONTRACT.json")),
    {
      __UPDATED_AT__: now,
      __AUTHORIZATION_REFERENCE__: "agent-context/evidence/INITIAL-ROLE-SETUP.json",
      __INITIAL_DECISION_ID__: `DEC-${todayCompact()}-001`,
      __DIRECTOR_THREAD_ID__: options.directorThreadId,
    },
  );
  const workStateText = substitute(
    readText(path.join(SKILL_ROOT, "templates/WORK-STATE.json")),
    {
      __UPDATED_AT__: now,
      __BRANCH__: branch,
      __BASE_SHA__: baseSha,
      __HEAD__: head,
    },
  );

  writeJsonAtomic(configPath, config);
  const contextDir = path.join(root, "agent-context");
  const evidenceDir = path.join(contextDir, "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  writeJsonAtomic(path.join(evidenceDir, "INITIAL-ROLE-SETUP.json"), {
    schemaVersion: 1,
    type: "initial-role-setup",
    createdAt: now,
    directorThreadId: options.directorThreadId,
    authority: "user-requested-initialization",
  });
  writeTextAtomic(path.join(contextDir, "ROLE-CONTRACT.json"), roleContractText);
  writeTextAtomic(path.join(contextDir, "WORK-STATE.json"), workStateText);
  writeTextAtomic(path.join(contextDir, "DECISION-LOG.jsonl"), "");
  appendJsonLine(path.join(contextDir, "DECISION-LOG.jsonl"), {
    id: `DEC-${todayCompact()}-001`,
    key: "director.role-initialization",
    date: now,
    status: "accepted",
    owner: "user",
    scope: ["coordination", "context"],
    decision: `Initialize the director role firewall for thread ${options.directorThreadId}.`,
    reason: "The user requested role-firewall initialization.",
    supersedes: [],
    supersededBy: null,
    evidence: [{ type: "file", ref: "agent-context/evidence/INITIAL-ROLE-SETUP.json" }],
    reviewWhen: "The coordinator role or runtime changes.",
  });
  fs.copyFileSync(
    path.join(SKILL_ROOT, "templates/AGENTS-role-section.md"),
    path.join(contextDir, "AGENTS-role-section.md"),
  );
  fs.copyFileSync(
    path.join(SKILL_ROOT, "templates/dispatch-prompt.md"),
    path.join(contextDir, "dispatch-prompt.md"),
  );
  writeResume(root, config);

  const targetRuntime = resolveRepoPath(root, ".director-role-firewall");
  copyRuntime(targetRuntime);
  if (options.adapters.includes("codex")) copyCodexAdapter(targetRuntime, root);

  const contract = readJson(path.join(contextDir, "ROLE-CONTRACT.json"));
  const errors = validateContractRuntime(contract, { root, config });
  if (errors.length > 0) throw new Error(`installed contract is invalid: ${errors[0].code}`);
  console.log(`INIT PASS root=${root} director=${options.directorThreadId} adapters=${options.adapters.join(",") || "generic"}`);
}

try {
  main();
} catch (error) {
  console.error(`INIT BLOCK: ${error.message}`);
  process.exit(1);
}
