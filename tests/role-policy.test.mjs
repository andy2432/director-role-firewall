import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  addWorkerTask,
  createRepo,
  parseOutput,
  readJson,
  removeRepo,
  roleContractPath,
  runGate,
  writeJson,
} from "./helpers.mjs";

let fixture;

test.before(() => {
  fixture = createRepo();
});

test.after(() => {
  removeRepo(fixture.root);
});

test("exact coordinator binding allows planning but blocks discovery", () => {
  const planning = runGate(fixture.root, {
    threadId: fixture.director,
    intent: "plan",
    plannedActions: [{ toolName: "exec_command", command: "git status --short --branch" }],
  });
  assert.equal(planning.status, 0, planning.stderr);
  assert.equal(parseOutput(planning).decision, "ALLOW");

  const discovery = runGate(fixture.root, {
    threadId: fixture.director,
    intent: "discover",
    plannedActions: [{ toolName: "list_threads" }],
  });
  assert.equal(discovery.status, 1);
  assert.equal(parseOutput(discovery).decision, "BLOCK");
  assert.equal(parseOutput(discovery).code, "ROLE_DISPATCH_REQUIRED");
});

test("title inference and forged dispatch are blocked", () => {
  const title = runGate(fixture.root, {
    threadId: "unknown-thread-0001",
    threadTitle: "Project director",
    actorMode: "worker",
    intent: "implement",
  });
  assert.equal(title.status, 1);
  assert.equal(parseOutput(title).code, "ROLE_TITLE_INFERENCE");

  const forged = runGate(fixture.root, {
    threadId: fixture.director,
    intent: "discover",
    dispatchSatisfied: true,
    dispatchedTaskIds: ["TASK-FORGED-001"],
    plannedActions: [{ toolName: "list_threads" }],
  });
  assert.equal(forged.status, 1);
  assert.equal(parseOutput(forged).code, "ROLE_DISPATCH_EVIDENCE_MISSING");
});

test("actual worker dispatch and one named evidence item are allowed", () => {
  const taskId = addWorkerTask(fixture.root, { head: fixture.head, status: "ready_for_review" });
  const result = runGate(fixture.root, {
    threadId: fixture.director,
    intent: "verify",
    plannedActions: [{ toolName: "exec_command", command: `git show --stat ${fixture.head}` }],
    dispatchedTaskIds: [taskId],
    dispatchSatisfied: true,
    workerDeliveryId: taskId,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseOutput(result).decision, "ALLOW");
});

test("business edits and raw history scans remain forbidden", () => {
  const business = runGate(fixture.root, {
    threadId: fixture.director,
    intent: "record",
    plannedActions: [{
      toolName: "apply_patch",
      paths: ["src/index.ts"],
      patch: "*** Update File: src/index.ts",
    }],
  });
  assert.equal(business.status, 1);
  assert.ok(["ROLE_ACTION_FORBIDDEN", "ROLE_ACTION_NOT_ALLOWED"].some((code) => business.stdout.includes(code)));

  const history = runGate(fixture.root, {
    threadId: fixture.director,
    intent: "verify",
    plannedActions: [{ toolName: "exec_command", command: "rg -n x .codex/sessions" }],
    dispatchedTaskIds: ["TASK-20261118-001"],
    dispatchSatisfied: true,
  });
  assert.equal(history.status, 1);
  assert.match(parseOutput(history).code, /ROLE_ACTION_FORBIDDEN/);
});

test("superseded director remains read-only", () => {
  const contractPath = roleContractPath(fixture.root);
  const contract = readJson(contractPath);
  contract.bindings[0].status = "superseded";
  contract.bindings.push({
    threadId: "thread-director-0002",
    profile: "director",
    status: "active",
    boundAt: "2026-11-18T00:00:00.000Z",
    authority: "test",
  });
  writeJson(contractPath, contract);
  const result = runGate(fixture.root, {
    threadId: fixture.director,
    actorMode: "worker",
    intent: "implement",
  });
  assert.equal(result.status, 1);
  assert.equal(parseOutput(result).code, "ROLE_DIRECTOR_SUPERSEDED");
});
