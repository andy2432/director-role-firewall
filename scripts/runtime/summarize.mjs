#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  configuredPath,
  fileExists,
  gitText,
  nowIso,
  readJson,
  sha256File,
  writeTextAtomic,
} from "./common.mjs";
import { activeDirectorBindings, loadDecisionLog, loadRoleContract, loadWorkState } from "./policy.mjs";

export function renderResume(root, config) {
  const contract = loadRoleContract(root, config);
  const workState = loadWorkState(root, config);
  const decisions = loadDecisionLog(root, config);
  const director = activeDirectorBindings(contract)[0] || null;
  const head = gitText(root, ["rev-parse", "HEAD"]) || "unversioned";
  const branch = gitText(root, ["branch", "--show-current"]) || "unversioned";
  const paths = {
    roleContract: configuredPath(root, config, "roleContract"),
    workState: configuredPath(root, config, "workState"),
    decisionLog: configuredPath(root, config, "decisionLog"),
  };
  const hashes = Object.fromEntries(
    Object.entries(paths).map(([key, filePath]) => [key, fileExists(filePath) ? sha256File(filePath) : "MISSING"]),
  );
  const lines = [
    "# DIRECTOR ROLE RESUME",
    "",
    `> generatedAt=${nowIso()}`,
    "> GENERATED FILE. Use the resume generator; do not add unique facts.",
    "",
    "## ROLE-CARD",
    "",
    "```text",
    "actorMode=director",
    `contractRevision=${contract.revision}`,
    `policyVersion=${contract.policyVersion}`,
    `guardMode=${contract.guardMode}`,
    `activeDirectorThread=${director?.threadId || "unbound"}`,
    "discovery=dispatch_first",
    "verify=one_summary,one_evidence",
    "succession=exact_user_command_only",
    "ifRoleUnknown=STOP_AND_RUN_ROLE_GATE",
    "```",
    "",
    "## REPOSITORY",
    "",
    `- branch: \`${branch}\``,
    `- head: \`${head}\``,
    `- worktree_tasks: ${(workState.tasks || []).length}`,
    "",
    "## ACTIVE WORK",
    "",
  ];
  for (const task of (workState.tasks || []).slice(0, 12)) {
    lines.push(`- \`${task.id}\` [${task.status}] ${task.title || "untitled"}; thread=${task.threadId || "unassigned"}`);
    if (task.nextAction) lines.push(`  next=${task.nextAction}`);
    if (task.evidencePointers?.length) {
      lines.push(`  evidence=${task.evidencePointers.map((pointer) => pointer.id).join(",")}`);
    }
  }
  if (!workState.tasks?.length) lines.push("- none");
  lines.push("", "## RECENT DECISIONS", "");
  for (const entry of decisions.slice(-5)) {
    lines.push(`- \`${entry.value.id}\` ${entry.value.decision}`);
  }
  if (!decisions.length) lines.push("- none");
  lines.push("", "## SOURCE HASHES", "");
  for (const [key, hash] of Object.entries(hashes)) lines.push(`- ${key}: \`${hash.slice(0, 16)}\``);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function writeResume(root, config) {
  const content = renderResume(root, config);
  writeTextAtomic(configuredPath(root, config, "contextResume"), content);
  return content;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.argv.includes("--root")
    ? path.resolve(process.argv[process.argv.indexOf("--root") + 1])
    : process.cwd();
  const { loadConfig } = await import("./common.mjs");
  const config = loadConfig(root);
  const content = writeResume(root, config);
  console.log(`RESUME WRITE PASS path=${configuredPath(root, config, "contextResume")} lines=${content.split(/\r?\n/).length}`);
}
