#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendJsonLine,
  configuredPath,
  loadConfig,
  nowIso,
  readText,
  resolveRepoPath,
  todayCompact,
  withFileLock,
  writeJsonAtomic,
  writeTextAtomic,
} from "./common.mjs";
import {
  activeDirectorBindings,
  getAnyBinding,
  isSuccessionPrompt,
  loadDecisionLog,
  loadRoleContract,
  validateContractRuntime,
} from "./policy.mjs";
import { writeResume } from "./summarize.mjs";

const THREAD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,}$/;

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    threadId: null,
    prompt: null,
    trigger: "exact-user-succession",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = path.resolve(argv[++index]);
    else if (arg === "--thread-id") options.threadId = argv[++index];
    else if (arg === "--prompt") options.prompt = argv[++index];
    else if (arg === "--trigger") options.trigger = argv[++index];
    else if (arg === "--json") options.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.threadId) throw new Error("--thread-id is required");
  return options;
}

function nextDecisionId(root, config) {
  const decisions = loadDecisionLog(root, config).map((entry) => entry.value.id);
  let index = 1;
  while (decisions.includes(`DEC-${todayCompact()}-${String(index).padStart(3, "0")}`)) index += 1;
  return `DEC-${todayCompact()}-${String(index).padStart(3, "0")}`;
}

export function performHandoff(options = {}) {
  const root = options.root || process.cwd();
  const config = options.config || loadConfig(root);
  const contract = loadRoleContract(root, config);
  const newThreadId = String(options.newThreadId || "");
  if (!THREAD_PATTERN.test(newThreadId)) throw new Error("new thread ID must be at least 8 safe characters");
  if (!options.prompt || !isSuccessionPrompt(options.prompt, contract.successionPhrases)) {
    throw new Error("handoff requires an exact configured succession phrase");
  }
  const contractPath = configuredPath(root, config, "roleContract");
  const decisionPath = configuredPath(root, config, "decisionLog");
  const lockPath = `${contractPath}.lock`;

  return withFileLock(lockPath, () => {
    const current = loadRoleContract(root, config);
    const currentDirector = activeDirectorBindings(current)[0] || null;
    if (currentDirector?.threadId === newThreadId) {
      return {
        status: "NOOP",
        previousThreadId: currentDirector.threadId,
        newThreadId,
        contractRevision: current.revision,
      };
    }
    const previous = currentDirector?.threadId || null;
    const now = nowIso();
    const decisionId = nextDecisionId(root, config);
    const evidenceDir = path.join(path.dirname(decisionPath), "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidenceRef = path.join(
      path.dirname(config.paths.decisionLog),
      "evidence",
      `DIRECTOR-HANDOFF-${now.replaceAll(":", "").replaceAll(".", "")}-${crypto.randomUUID().slice(0, 8)}.json`,
    ).replaceAll("\\", "/");
    const evidence = {
      schemaVersion: 1,
      type: "director-thread-handoff",
      trigger: options.trigger || "exact-user-succession",
      requestedAt: now,
      previousDirectorThreadId: previous,
      newDirectorThreadId: newThreadId,
      authority: "user-confirmed-succession",
      promptSha256: crypto.createHash("sha256").update(options.prompt).digest("hex"),
    };
    writeJsonAtomic(resolveRepoPath(root, evidenceRef), evidence);

    const decision = {
      id: decisionId,
      key: "director.thread-binding",
      date: now,
      status: "accepted",
      owner: "user",
      scope: ["coordination", "context", "runtime"],
      decision: `Bind director role to exact thread ${newThreadId}.`,
      reason: "The user issued an exact configured succession command.",
      supersedes: [],
      supersededBy: null,
      evidence: [{ type: "file", ref: evidenceRef }],
      reviewWhen: "The director thread changes again.",
    };
    appendJsonLine(decisionPath, decision);

    for (const binding of current.bindings || []) {
      if (binding.profile === "director" && binding.status === "active") {
        binding.status = "superseded";
        binding.supersededAt = now;
        binding.supersededBy = newThreadId;
        binding.supersededByDecision = decisionId;
      }
    }
    const binding = {
      threadId: newThreadId,
      profile: "director",
      status: "active",
      boundAt: now,
      authority: "user-confirmed-succession",
      handoffFrom: previous,
      handoffDecision: decisionId,
    };
    const existing = (current.bindings || []).findIndex((item) => item.threadId === newThreadId);
    if (existing >= 0) current.bindings[existing] = binding;
    else current.bindings.push(binding);
    current.revision = Number(current.revision) + 1;
    current.updatedAt = now;
    current.authorization = {
      sourceType: "user",
      reference: evidenceRef,
      decisionId,
      outcome: `Bind director role to thread ${newThreadId}`,
    };
    current.lastHandoff = {
      decisionId,
      previousDirectorThreadId: previous,
      activeDirectorThreadId: newThreadId,
      at: now,
      evidence: evidenceRef,
    };
    const errors = validateContractRuntime(current, { root, config });
    if (errors.length > 0) throw new Error(`handoff produced invalid contract: ${errors[0].code}`);
    writeJsonAtomic(contractPath, current);
    const resume = writeResume(root, config);
    return {
      status: "BOUND",
      previousThreadId: previous,
      newThreadId,
      decisionId,
      evidenceRef,
      contractRevision: current.revision,
      resumeLines: resume.split(/\r?\n/).length,
    };
  });
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = performHandoff({
      root: options.root,
      newThreadId: options.threadId,
      prompt: options.prompt,
      trigger: options.trigger,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`HANDOFF ${result.status} previous=${result.previousThreadId || "none"} new=${result.newThreadId} revision=${result.contractRevision}`);
  } catch (error) {
    console.error(`HANDOFF BLOCK: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
