import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const INIT_SCRIPT = path.join(PACKAGE_ROOT, "scripts/init.mjs");

export function createRepo({ director = "thread-director-0001" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "director-role-firewall-test-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "initial"]);
  const init = spawnSync(process.execPath, [
    INIT_SCRIPT,
    "--root",
    root,
    "--director-thread-id",
    director,
    "--adapter",
    "codex",
  ], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (init.status !== 0) throw new Error(`init failed: ${init.stderr}\n${init.stdout}`);
  return { root, director, head: git(root, ["rev-parse", "HEAD"]) };
}

export function removeRepo(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

export function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

export function runNode(filePath, args, input = null, cwd = PACKAGE_ROOT) {
  return spawnSync(process.execPath, [filePath, ...args], {
    cwd,
    input: input === null ? undefined : JSON.stringify(input),
    encoding: "utf8",
    windowsHide: true,
  });
}

export function runGate(root, request) {
  return runNode(
    path.join(root, ".director-role-firewall/role-gate.mjs"),
    ["--root", root, "--request", "-", "--json"],
    request,
    root,
  );
}

export function parseOutput(result) {
  return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function workStatePath(root) {
  return path.join(root, "agent-context/WORK-STATE.json");
}

export function roleContractPath(root) {
  return path.join(root, "agent-context/ROLE-CONTRACT.json");
}

export function addWorkerTask(root, { id = "TASK-20261118-001", status = "active", threadId = "worker-thread-0001", head }) {
  const workState = readJson(workStatePath(root));
  workState.tasks.push({
    id,
    title: "Fixture worker task",
    status,
    actorMode: "worker",
    owner: "worker",
    threadId,
    scope: ["fixture"],
    forbidden: ["business-code"],
    acceptance: ["evidence exists"],
    evidencePointers: head ? [{
      id: "EV-COMMIT",
      type: "commit",
      value: head,
      allowedCheck: `git show --stat ${head}`,
    }] : [],
  });
  writeJson(workStatePath(root), workState);
  return id;
}
