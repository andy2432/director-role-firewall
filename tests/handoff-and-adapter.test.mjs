import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createRepo,
  parseOutput,
  readJson,
  removeRepo,
  roleContractPath,
  runNode,
} from "./helpers.mjs";

let fixture;

test.before(() => {
  fixture = createRepo();
});

test.after(() => {
  removeRepo(fixture.root);
});

test("handoff creates one active director and an evidence-backed decision", () => {
  const result = runNode(
    path.join(fixture.root, ".director-role-firewall/handoff.mjs"),
    ["--root", fixture.root, "--thread-id", "thread-director-0002", "--prompt", "接任项目总监", "--json"],
    null,
    fixture.root,
  );
  assert.equal(result.status, 0, result.stderr);
  const output = parseOutput(result);
  assert.equal(output.status, "BOUND");
  const contract = readJson(roleContractPath(fixture.root));
  const active = contract.bindings.filter((binding) => binding.profile === "director" && binding.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].threadId, "thread-director-0002");
  assert.ok(fs.existsSync(path.join(fixture.root, output.evidenceRef)));
});

test("Codex adapter blocks list_threads before dispatch", () => {
  const adapter = path.join(fixture.root, ".director-role-firewall/codex-role-guard.mjs");
  const prompt = runNode(adapter, ["user-prompt"], {
    session_id: "thread-director-0002",
    turn_id: "hook-turn-1",
    prompt: "Investigate the history and find the root cause",
  }, fixture.root);
  assert.equal(prompt.status, 0, prompt.stderr);

  const blocked = runNode(adapter, ["pre-tool"], {
    session_id: "thread-director-0002",
    turn_id: "hook-turn-1",
    tool_name: "mcp__agent__list_threads",
    tool_use_id: "tool-1",
    tool_input: {},
  }, fixture.root);
  assert.equal(blocked.status, 0, blocked.stderr);
  const output = parseOutput(blocked);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /ROLE_DISPATCH_REQUIRED/);
});

test("generic self-test and generated hooks config are valid", () => {
  const gate = runNode(
    path.join(fixture.root, ".director-role-firewall/role-gate.mjs"),
    ["--root", fixture.root, "--self-test"],
    null,
    fixture.root,
  );
  assert.equal(gate.status, 0, gate.stderr);
  const hooks = readJson(path.join(fixture.root, ".codex/hooks.json"));
  assert.ok(hooks.hooks.PreToolUse);
});
