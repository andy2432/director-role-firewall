#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./common.mjs";
import {
  actionFromTool,
  classifyPrompt,
  evaluateRequest,
  getAnyBinding,
  getActiveBinding,
  inferRoleAction,
  isSuccessionPrompt,
  loadRoleContract,
  loadWorkState,
  parseTaskId,
  validateContractRuntime,
} from "./policy.mjs";
import { performHandoff } from "./handoff.mjs";
import {
  ensureState,
  extractThreadId,
  readState,
  resetTurn,
  updateState,
} from "./state.mjs";

const RUNTIME_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(RUNTIME_ROOT, "..");
const config = loadConfig(ROOT);

function readInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function output(value) {
  if (value !== undefined && value !== null) process.stdout.write(`${JSON.stringify(value)}\n`);
}

function roleCard(contract) {
  const director = contract.bindings.find((binding) => binding.profile === "director" && binding.status === "active");
  return [
    "ROLE-GATE director",
    `contractRevision=${contract.revision}`,
    `policyVersion=${contract.policyVersion}`,
    `guardMode=${contract.guardMode}`,
    `activeDirectorThread=${director?.threadId || "unbound"}`,
    "discovery=dispatch_first",
    "verify=one_summary,one_evidence",
    "succession=exact_user_command_only",
    "ifRoleUnknown=STOP_AND_RUN_ROLE_GATE",
  ].join("\n");
}

function context(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function loadRole() {
  const contract = loadRoleContract(ROOT, config);
  const errors = validateContractRuntime(contract, { root: ROOT, config });
  if (errors.length) throw new Error(`${errors[0].code}: ${errors[0].message}`);
  return contract;
}

function isDirector(contract, threadId) {
  return getActiveBinding(contract, threadId)?.profile === "director";
}

function isSuperseded(contract, threadId) {
  const binding = getAnyBinding(contract, threadId);
  return binding?.profile === "director" && binding.status === "superseded";
}

function sessionStart(input) {
  const contract = loadRole();
  if (isSuperseded(contract, input.session_id)) {
    return context("SessionStart", "ROLE-GATE superseded director. This thread is read-only historical context.");
  }
  if (!isDirector(contract, input.session_id)) return null;
  ensureState(ROOT, config, input.session_id, contract);
  updateState(ROOT, config, input.session_id, (state) => {
    state.compaction.roleCardPending = false;
  });
  return context("SessionStart", `${roleCard(contract)}\nsource=${input.source || "startup"}`);
}

function userPrompt(input) {
  let contract = loadRole();
  if (isSuperseded(contract, input.session_id)) {
    return context(
      "UserPromptSubmit",
      "ROLE-GATE superseded director. Do not dispatch, investigate, implement, accept, or release from this thread.",
    );
  }
  if (isSuccessionPrompt(input.prompt, contract.successionPhrases)) {
    try {
      const handoff = performHandoff({
        root: ROOT,
        config,
        newThreadId: input.session_id,
        prompt: input.prompt,
        trigger: "exact-user-succession",
      });
      contract = loadRole();
      ensureState(ROOT, config, input.session_id, contract);
      return context(
        "UserPromptSubmit",
        `${roleCard(contract)}\nDirector succession ${handoff.status}; previous=${handoff.previousThreadId || "none"}.`,
      );
    } catch (error) {
      return { decision: "block", reason: `DIRECTOR_SUCCESSION_FAILED: ${error.message}` };
    }
  }
  if (!isDirector(contract, input.session_id)) return null;
  const classification = classifyPrompt(input.prompt);
  ensureState(ROOT, config, input.session_id, contract);
  let pending = false;
  updateState(ROOT, config, input.session_id, (state) => {
    resetTurn(state, input.turn_id, classification);
    pending = state.compaction.roleCardPending;
    state.compaction.roleCardPending = false;
  });
  if (!classification.dispatchRequired && !pending) return null;
  return context(
    "UserPromptSubmit",
    `${roleCard(contract)}\n` +
    (classification.dispatchRequired
      ? "This prompt requires discovery or implementation. Create or send a worker task before investigation."
      : "Reload the role card after compaction."),
  );
}

function addViolation(state, code, message, input) {
  state.violations.push({
    code,
    message,
    toolName: input.tool_name,
    toolUseId: input.tool_use_id,
    turnId: state.currentTurn.turnId,
    at: new Date().toISOString(),
  });
  state.violations = state.violations.slice(-20);
}

function preTool(input) {
  const contract = loadRole();
  if (isSuperseded(contract, input.session_id)) {
    return contract.guardMode === "deny" ? deny("ROLE_DIRECTOR_SUPERSEDED: this thread is read-only") : null;
  }
  if (!isDirector(contract, input.session_id)) return null;
  const state = readState(ROOT, config, input.session_id) || ensureState(ROOT, config, input.session_id, contract);
  const action = actionFromTool(input.tool_name, input.tool_input);
  const actionType = inferRoleAction(action, contract);
  const evaluation = evaluateRequest({
    root: ROOT,
    config,
    contract,
    workState: loadWorkState(ROOT, config),
    request: {
      threadId: input.session_id,
      intent: state.currentTurn.intent,
      plannedActions: [action],
      dispatchedTaskIds: state.currentTurn.dispatchedTaskIds,
      dispatchSatisfied: state.currentTurn.dispatchSatisfied,
      workerDeliveryId: state.currentTurn.activeTaskId,
      verificationBudgetUsed: state.currentTurn.budgetUsed,
    },
    runtime: {
      trusted: true,
      dispatchReceipts: state.currentTurn.dispatchReceipts,
    },
  });
  let decision = null;
  updateState(ROOT, config, input.session_id, (next) => {
    if (evaluation.decision === "BLOCK") {
      addViolation(next, evaluation.code, evaluation.message, input);
      if (contract.guardMode === "deny") decision = deny(`${evaluation.code}: ${evaluation.message}. HANDOFF is required.`);
    } else if (evaluation.facts.verificationBudgetUsed) {
      next.currentTurn.budgetUsed = evaluation.facts.verificationBudgetUsed;
    }
  });
  return decision;
}

function postTool(input) {
  const contract = loadRole();
  if (!isDirector(contract, input.session_id)) return null;
  const action = actionFromTool(input.tool_name, input.tool_input);
  const actionType = inferRoleAction(action, contract);
  updateState(ROOT, config, input.session_id, (state) => {
    if (actionType !== "dispatch") return;
    const taskId = action.taskId || parseTaskId(action.prompt);
    const threadId = action.threadId || extractThreadId(input.tool_response);
    if (taskId) {
      state.currentTurn.activeTaskId = taskId;
      if (!state.currentTurn.dispatchedTaskIds.includes(taskId)) state.currentTurn.dispatchedTaskIds.push(taskId);
    }
    if (taskId && threadId) {
      state.currentTurn.dispatchSatisfied = true;
      state.currentTurn.dispatchReceipts.push({
        taskId,
        threadId,
        toolName: input.tool_name,
        toolUseId: input.tool_use_id || null,
        at: new Date().toISOString(),
      });
      state.currentTurn.dispatchReceipts = state.currentTurn.dispatchReceipts.slice(-10);
    }
  });
  return null;
}

function compact(input, event) {
  const contract = loadRole();
  if (!isDirector(contract, input.session_id)) return null;
  ensureState(ROOT, config, input.session_id, contract);
  updateState(ROOT, config, input.session_id, (state) => {
    if (event === "PreCompact") state.compaction.pending = true;
    else {
      state.compaction.pending = false;
      state.compaction.roleCardPending = true;
      state.compaction.count += 1;
    }
  });
  return null;
}

function stop(input) {
  const contract = loadRole();
  if (!isDirector(contract, input.session_id) || contract.guardMode !== "deny" || input.stop_hook_active) return null;
  const state = readState(ROOT, config, input.session_id);
  if (!state || (state.currentTurn.dispatchRequired && state.currentTurn.dispatchSatisfied)) return null;
  const violation = (state.violations || []).find((item) => item.turnId === state.currentTurn.turnId);
  if (!violation) return null;
  return {
    decision: "block",
    reason: `ROLE_DRIFT_DETECTED: ${violation.code}. Dispatch the work and keep only task/thread IDs and one evidence pointer.`,
  };
}

try {
  const event = process.argv[2];
  const input = readInput();
  if (event === "session-start") output(sessionStart(input));
  else if (event === "user-prompt") output(userPrompt(input));
  else if (event === "pre-tool") output(preTool(input));
  else if (event === "post-tool") output(postTool(input));
  else if (event === "pre-compact") output(compact(input, "PreCompact"));
  else if (event === "post-compact") output(compact(input, "PostCompact"));
  else if (event === "stop") output(stop(input));
  else throw new Error(`unknown hook event: ${event}`);
} catch (error) {
  const event = process.argv[2];
  if (event === "pre-tool") output(deny(`ROLE_GUARD_ERROR: ${error.message}`));
  else output({ systemMessage: `ROLE_GUARD_ERROR: ${error.message}` });
}
