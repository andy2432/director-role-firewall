import fs from "node:fs";
import path from "node:path";
import {
  ACTIVE_BINDING_STATUS,
  POLICY_VERSION,
  SCHEMA_VERSION,
  SUPERSEDED_BINDING_STATUS,
  commitExists,
  configuredPath,
  fileExists,
  loadConfig,
  readJson,
  readJsonLines,
  readText,
  resolveRepoPath,
  toPosix,
} from "./common.mjs";

export const ROLE_ACTION_TYPES = new Set([
  "plan",
  "dispatch",
  "monitor",
  "read_worker_summary",
  "verify_read",
  "verify_command",
  "precise_thread_read",
  "record",
  "orchestrate_release",
  "broad_thread_search",
  "raw_rollout_scan",
  "history_reconstruction",
  "open_ended_code_exploration",
  "debug_implementation",
  "edit_business_code",
  "long_log_analysis",
  "repeat_full_worker_investigation",
  "self_assign_unscoped_audit",
]);

const DISPATCH_REQUIRED_INTENTS = new Set([
  "discover",
  "history_scan",
  "history_reconstruction",
  "diagnose",
  "debug",
  "implement",
]);

const DIRECTOR_FORBIDDEN_ACTIONS = new Set([
  "broad_thread_search",
  "raw_rollout_scan",
  "history_reconstruction",
  "open_ended_code_exploration",
  "debug_implementation",
  "edit_business_code",
  "long_log_analysis",
  "repeat_full_worker_investigation",
  "self_assign_unscoped_audit",
]);

const PRE_DISPATCH_ACTIONS = new Set(["plan", "dispatch", "monitor", "record"]);
const VERIFY_ACTIONS = new Set(["verify_read", "verify_command", "precise_thread_read"]);

const SIMPLE_ACTION_MAP = new Map([
  ["git_show", "verify_command"],
  ["run_named_test", "verify_command"],
  ["read_file_range", "verify_read"],
  ["read_worker_summary", "read_worker_summary"],
  ["list_threads", "broad_thread_search"],
  ["read_thread", "precise_thread_read"],
  ["create_task", "dispatch"],
  ["send_task", "dispatch"],
  ["wait_task", "monitor"],
  ["record_decision", "record"],
  ["update_ledger", "record"],
  ["orchestrate_release", "orchestrate_release"],
]);

export function loadRoleContract(root, config = loadConfig(root)) {
  return readJson(configuredPath(root, config, "roleContract"));
}

export function loadWorkState(root, config = loadConfig(root)) {
  return readJson(configuredPath(root, config, "workState"));
}

export function loadDecisionLog(root, config = loadConfig(root)) {
  return readJsonLines(configuredPath(root, config, "decisionLog"));
}

export function activeBindings(contract) {
  return (contract?.bindings || []).filter((binding) => binding.status === ACTIVE_BINDING_STATUS);
}

export function activeDirectorBindings(contract) {
  return activeBindings(contract).filter((binding) => binding.profile === "director");
}

export function getAnyBinding(contract, threadId) {
  if (!threadId) return null;
  return (contract?.bindings || []).find((binding) => binding.threadId === threadId) || null;
}

export function getActiveBinding(contract, threadId) {
  const binding = getAnyBinding(contract, threadId);
  return binding?.status === ACTIVE_BINDING_STATUS ? binding : null;
}

export function validateContractRuntime(contract, options = {}) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return [{ code: "ROLE_CONTRACT_MISSING", message: "role contract must be an object" }];
  }
  if (contract.schemaVersion !== SCHEMA_VERSION) add("ROLE_CONTRACT_SCHEMA", "schemaVersion must be 1");
  if (!Number.isInteger(contract.revision) || contract.revision < 1) {
    add("ROLE_CONTRACT_REVISION", "revision must be a positive integer");
  }
  if (contract.policyVersion !== POLICY_VERSION) add("ROLE_POLICY_VERSION", `policyVersion must be ${POLICY_VERSION}`);
  if (!["audit", "deny"].includes(contract.guardMode)) add("ROLE_GUARD_MODE", "guardMode must be audit or deny");
  if (contract.unknownThreadDefaultProfile !== "worker") {
    add("ROLE_UNKNOWN_DEFAULT", "unknownThreadDefaultProfile must be worker");
  }
  if (!Array.isArray(contract.successionPhrases) || contract.successionPhrases.length === 0) {
    add("ROLE_SUCCESSION_PHRASES", "successionPhrases must be non-empty");
  }
  if (!Array.isArray(contract.businessPathPatterns)) {
    add("ROLE_BUSINESS_PATTERNS", "businessPathPatterns must be an array");
  }
  const director = contract.profiles?.director;
  const worker = contract.profiles?.worker;
  if (!director || director.purpose !== "context_firewall" || director.handoffRequired !== true) {
    add("ROLE_DIRECTOR_PROFILE", "director profile must be a context firewall with handoffRequired=true");
  }
  if (!worker || worker.purpose !== "produce_evidence_or_change") {
    add("ROLE_WORKER_PROFILE", "worker profile is missing or invalid");
  }
  const activeDirectors = activeDirectorBindings(contract);
  if (activeDirectors.length > 1) add("ROLE_MULTIPLE_DIRECTORS", "at most one active director is allowed");
  if (options.requireDirector !== false && activeDirectors.length === 0) {
    add("ROLE_NO_ACTIVE_DIRECTOR", "an active director binding is required");
  }

  const seen = new Set();
  for (const binding of contract.bindings || []) {
    if (!binding.threadId || !binding.profile || !binding.status) {
      add("ROLE_BINDING_FIELD", "each binding needs threadId, profile, and status");
      continue;
    }
    if (seen.has(binding.threadId)) add("ROLE_BINDING_DUPLICATE", `duplicate binding ${binding.threadId}`);
    seen.add(binding.threadId);
    if (!["active", "superseded"].includes(binding.status)) add("ROLE_BINDING_STATUS", "binding status is invalid");
  }

  if (director) {
    for (const action of [
      "plan",
      "dispatch",
      "monitor",
      "read_worker_summary",
      "verify_read",
      "verify_command",
      "precise_thread_read",
      "record",
      "orchestrate_release",
    ]) {
      if (!director.allowedActions?.includes(action)) {
        add("ROLE_REQUIRED_ACTION_MISSING", `director.allowedActions must include ${action}`);
      }
    }
    for (const action of DIRECTOR_FORBIDDEN_ACTIONS) {
      if (!director.forbiddenActions?.includes(action)) {
        add("ROLE_REQUIRED_FORBIDDEN_ACTION_MISSING", `director.forbiddenActions must include ${action}`);
      }
    }
    const budget = director.verificationBudget || {};
    if (budget.maxSummaryLines !== 20) add("ROLE_SUMMARY_BUDGET", "maxSummaryLines must be 20");
    if (budget.maxEvidenceItems !== 1) add("ROLE_EVIDENCE_BUDGET", "maxEvidenceItems must be 1");
    if (budget.maxReadOperationsPerDelivery !== 1) add("ROLE_READ_BUDGET", "maxReadOperationsPerDelivery must be 1");
    if (budget.allowWildcardSearch !== false || budget.allowFollowOnInvestigation !== false) {
      add("ROLE_VERIFY_BUDGET_UNSAFE", "wildcard and follow-on verification must be disabled");
    }
    if (!Array.isArray(director.dispatchPriority) || !["create_task", "send_task"].includes(director.dispatchPriority[0])) {
      add("ROLE_DISPATCH_PRIORITY", "dispatchPriority must begin with create_task or send_task");
    }
  }

  if (options.root && contract.authorization) {
    let decisions = [];
    try {
      decisions = loadDecisionLog(options.root, options.config || loadConfig(options.root));
    } catch {
      add("ROLE_AUTHORIZATION_LOG", "cannot read DECISION-LOG.jsonl");
    }
    const decision = decisions.find((entry) => entry.value.id === contract.authorization.decisionId);
    if (
      !decision
      || !["active", "accepted"].includes(decision.value.status)
      || !["user", "用户"].includes(decision.value.owner)
    ) {
      add("ROLE_AUTHORIZATION_DECISION", "authorization must reference an accepted user decision");
    }
    if (contract.authorization.reference && !fileExists(resolveRepoPath(options.root, contract.authorization.reference))) {
      add("ROLE_AUTHORIZATION_REFERENCE", "authorization reference does not exist");
    }
    if (contract.lastHandoff) {
      const handoffDecision = decisions.find((entry) => entry.value.id === contract.lastHandoff.decisionId);
      if (!handoffDecision || handoffDecision.value.status !== "accepted") {
        add("ROLE_HANDOFF_DECISION", "lastHandoff must reference an accepted decision");
      }
      if (!fileExists(resolveRepoPath(options.root, contract.lastHandoff.evidence))) {
        add("ROLE_HANDOFF_EVIDENCE", "lastHandoff evidence does not exist");
      }
    }
  }
  return errors;
}

export function classifyPrompt(prompt) {
  const text = String(prompt || "");
  const correction = /不是让你.*自己|不要自己干活|你是不是忘了.*职责|先派单|为什么.*忘记.*要求|dispatch first/i;
  const explicitVerify = /只读核验|独立验收|复核这个证据|确认这个 commit|确认这个测试|核对这一行|verify this evidence|check this commit/i;
  const implementation = /修复代码|实现功能|修改代码|调试|定位 bug|提交代码|部署|上线|fix code|implement|debug|deploy/i;
  const followOn = /发现.*(?:异常|问题)|继续.*(?:调查|追查)|根因|进一步查|顺藤摸瓜|follow.?on|new anomaly|continue investigating/i;
  const discovery = /重新研究|继续研究|查清|调查|梳理|重建|重读|核对历史|读取.*线程|找.*前任|分析原因|具体方案|饱和测试|investigate|research|trace|find.*thread|rebuild.*history/i;

  if (correction.test(text)) return { intent: "discover", dispatchRequired: true, reason: "role correction" };
  if (explicitVerify.test(text)) return { intent: "verify", dispatchRequired: false, reason: "bounded verification" };
  if (implementation.test(text)) return { intent: "implement", dispatchRequired: true, reason: "implementation belongs to worker" };
  if (followOn.test(text)) return { intent: "diagnose", dispatchRequired: true, reason: "follow-on work belongs to worker" };
  if (discovery.test(text)) return { intent: "discover", dispatchRequired: true, reason: "discovery belongs to worker" };
  return { intent: "coordinate", dispatchRequired: false, reason: "coordination" };
}

export function isSuccessionPrompt(prompt, phrases) {
  const text = String(prompt || "").trim();
  return (phrases || []).some((phrase) => text === String(phrase).trim());
}

export function canonicalToolName(name) {
  return String(name || "")
    .replace(/^mcp__[^_]+__/, "")
    .replace(/^mcp__.+?__/, "");
}

export function pathLooksLikeBusiness(relativePath, patterns) {
  const value = toPosix(relativePath || "");
  if (!value) return false;
  return (patterns || []).some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(value);
    } catch {
      return false;
    }
  });
}

function isReadOnlyOrientation(command) {
  return /^(?:git\s+(?:status\s+--short\s+--branch|rev-parse\s+HEAD)|node\s+.+director-role-firewall.+--self-test)$/i.test(
    String(command || "").trim(),
  );
}

export function isSafeVerificationCommand(command) {
  const value = String(command || "").trim();
  if (!value || /[;&|`<>\r\n]|\$\(|%0a/i.test(value)) return false;
  return [
    /^git\s+(?:show|diff|status|rev-parse|cat-file|hash-object)(?:\s|$)/i,
    /^npm\s+test(?:\s|$)/i,
    /^npx\s+(?:jest|vitest)(?:\s|$)/i,
    /^node\s+--test(?:\s|$)/i,
    /^node\s+.+\.director-role-firewall[\\/]evidence-read\.mjs(?:\s|$)/i,
    /^python(?:3)?\s+-m\s+pytest(?:\s|$)/i,
    /^(?:pytest|ctest)(?:\s|$)/i,
    /^(?:sha256sum|shasum)(?:\s|$)/i,
    /^Get-FileHash(?:\s|$)/i,
  ].some((pattern) => pattern.test(value));
}

function parseApplyPatchPaths(text) {
  return Array.from(
    String(text || "").matchAll(/^\*\*\*\s+(?:(?:Update|Add|Delete) File|Move to):\s+(.+)$/gm),
    (match) => match[1].trim(),
  );
}

export function actionFromTool(toolName, toolInput = {}) {
  const tool = canonicalToolName(toolName);
  const command = toolInput.command || toolInput.cmd || "";
  return {
    toolName: tool,
    command,
    path: toolInput.path || null,
    paths: toolInput.paths || toolInput.files || [],
    patch: tool === "apply_patch" ? command : (toolInput.patch || toolInput.input || ""),
    prompt: toolInput.prompt || "",
    taskId: toolInput.taskId || toolInput.task_id || null,
    threadId: toolInput.threadId || toolInput.thread_id || null,
    maxTurns: toolInput.turnLimit ?? toolInput.maxTurns,
    includeOutputs: toolInput.includeOutputs,
  };
}

export function inferRoleAction(input, contract) {
  if (typeof input === "string") return SIMPLE_ACTION_MAP.get(input) || input;
  const action = input || {};
  const tool = canonicalToolName(action.toolName || action.tool);
  const command = String(action.command || "");
  const candidates = [action.path, ...(action.paths || []), ...(action.files || [])].filter(Boolean).map(String);

  if (
    /(?:\.codex|\.claude|\.cursor)[\\/]+(?:sessions|archived_sessions|projects)|session_index\.jsonl|rollout-.*\.jsonl|thread_history_\d+\.sqlite|\.codex-global-state\.json/i.test(command)
    || candidates.some((candidate) => /(?:\.codex|\.claude|\.cursor)[\\/]+(?:sessions|archived_sessions|projects)|rollout-.*\.jsonl/i.test(candidate))
  ) {
    return "raw_rollout_scan";
  }
  if (/Get-ChildItem[\s\S]+sessions|ForEach-Object[\s\S]+rollout/i.test(command)) return "raw_rollout_scan";
  if (["create_thread", "send_message_to_thread", "create_task", "send_task", "spawn_agent"].includes(tool)) {
    return "dispatch";
  }
  if (["wait_threads", "wait_agent", "monitor_task"].includes(tool)) return "monitor";
  if (["list_threads", "search_threads", "find_threads", "list_sessions"].includes(tool)) {
    return "broad_thread_search";
  }
  if (["read_thread", "get_thread"].includes(tool)) return "precise_thread_read";
  if (["apply_patch", "edit_file", "write_file"].includes(tool)) {
    const paths = [...candidates, ...parseApplyPatchPaths(action.patch || action.diff)];
    return paths.length > 0 && paths.every((item) => !pathLooksLikeBusiness(item, contract?.businessPathPatterns))
      ? "record"
      : "edit_business_code";
  }
  if (["exec_command", "Bash", "bash", "shell"].includes(tool)) {
    if (isReadOnlyOrientation(command)) return "plan";
    if (isSafeVerificationCommand(command)) {
      return /evidence-read\.mjs/i.test(command) ? "verify_read" : "verify_command";
    }
    if (/rg|Select-String|Get-ChildItem/.test(command) && candidates.length > 1) {
      return "open_ended_code_exploration";
    }
    if (/(?:Get-Content|Select-String|type\s|cat\s|tail\s|head\s)/i.test(command)) {
      return "long_log_analysis";
    }
    return "open_ended_code_exploration";
  }
  if (["read_file", "read_document"].includes(tool)) return "verify_read";
  return action.actionType || "self_assign_unscoped_audit";
}

export function parseTaskId(text) {
  const match = String(text || "").match(/\b[A-Z][A-Z0-9_-]*-\d{8}-[A-Z0-9-]+\b/);
  return match ? match[0] : null;
}

function isWorkerDispatchPrompt(prompt) {
  const text = String(prompt || "");
  return /(?:^|\n)\s*actorMode\s*[:=]\s*["']?worker["']?/i.test(text)
    && /(?:^|\n)\s*(?:taskId|TASK-ID)\s*[:=]\s*[A-Z][A-Z0-9_-]*-\d{8}-[A-Z0-9-]+\b/i.test(text)
    && /(?:scope|范围)\s*[:=]/i.test(text)
    && /(?:forbidden|禁止)\s*[:=]/i.test(text);
}

function taskById(workState, taskId) {
  return (workState?.tasks || []).find((task) => task.id === taskId) || null;
}

function isReadyDelivery(task) {
  return task?.actorMode === "worker"
    && task.status === "ready_for_review"
    && Boolean(task.threadId)
    && Array.isArray(task.evidencePointers)
    && task.evidencePointers.length > 0;
}

function pointerExists(root, pointer, action) {
  if (!pointer?.id || !pointer.type || !pointer.value) return false;
  if (pointer.type === "commit") return commitExists(root, pointer.value);
  if (["report", "file", "file_range", "json", "json_path"].includes(pointer.type)) {
    const relative = String(pointer.value).split("#")[0];
    const absolute = resolveRepoPath(root, relative);
    if (!fileExists(absolute)) return false;
    if (action.startLine && action.endLine) {
      const lines = readText(absolute).split(/\r?\n/).length;
      if (action.endLine > lines) return false;
    }
    return true;
  }
  return pointer.type === "thread" || Boolean(pointer.allowedCheck);
}

function findEvidenceMatch(root, workState, action, actionType, preferredTaskId) {
  const tasks = (workState?.tasks || []).filter((task) => (
    isReadyDelivery(task) && (!preferredTaskId || task.id === preferredTaskId)
  ));
  const helper = String(action.command || "").match(
    /evidence-read\.mjs[\s\S]*--task\s+([^\s]+)[\s\S]*--pointer\s+([^\s]+)/i,
  );
  for (const task of tasks) {
    for (const pointer of task.evidencePointers) {
      if (!pointerExists(root, pointer, action)) continue;
      if (helper) {
        if (helper[1] === task.id && helper[2] === pointer.id) return { task, pointer };
        continue;
      }
      if (actionType === "precise_thread_read") {
        const expected = pointer.type === "thread" ? pointer.value : task.threadId;
        if (action.threadId === expected) return { task, pointer };
      } else if (actionType === "verify_command") {
        const expected = [pointer.allowedCheck, pointer.command, pointer.value].filter((value) => typeof value === "string");
        if (expected.includes(action.command)) return { task, pointer };
        if (pointer.type === "commit" && action.command.startsWith("git show") && action.command.includes(pointer.value)) {
          return { task, pointer };
        }
      } else if (actionType === "verify_read") {
        const actionPath = action.path ? toPosix(action.path) : null;
        const pointerPath = pointer.value ? toPosix(String(pointer.value).split("#")[0]) : null;
        if (actionPath && pointerPath && actionPath === pointerPath) return { task, pointer };
        if (helper && helper[1] === task.id && helper[2] === pointer.id) return { task, pointer };
      }
    }
  }
  return null;
}

function block(code, message = "") {
  return { block: true, code, message };
}

export function evaluateRequest(options = {}) {
  const root = options.root || process.cwd();
  const config = options.config || loadConfig(root);
  const contract = options.contract || loadRoleContract(root, config);
  const workState = options.workState || loadWorkState(root, config);
  const runtime = options.runtime || {};
  const request = options.request || {};
  const blocks = [];
  const add = (code, message) => blocks.push(block(code, message));
  const contractErrors = validateContractRuntime(contract, { root, config });
  if (contractErrors.length > 0) {
    return result("BLOCK", "director", contractErrors[0], contractErrors, {});
  }

  const threadId = String(request.threadId || "");
  const anyBinding = getAnyBinding(contract, threadId);
  const binding = getActiveBinding(contract, threadId);
  const bindingProfile = binding?.profile || null;
  const requestedActor = request.actorMode || bindingProfile || contract.unknownThreadDefaultProfile;
  if (anyBinding?.profile === "director" && anyBinding.status === SUPERSEDED_BINDING_STATUS) {
    add("ROLE_DIRECTOR_SUPERSEDED", "superseded director threads are read-only");
  } else if (request.threadTitle && /director|总监/i.test(request.threadTitle) && !binding) {
    add("ROLE_TITLE_INFERENCE", "a title is not role evidence; bind the exact thread ID");
  }
  if (blocks.length > 0) return result("BLOCK", "superseded_director", blocks[0], blocks, {});

  if (bindingProfile && request.actorMode && request.actorMode !== bindingProfile) {
    return result("BLOCK", bindingProfile, block("ROLE_BINDING_CONFLICT", "actorMode conflicts with binding"), [
      block("ROLE_BINDING_CONFLICT", "actorMode conflicts with binding"),
    ], {});
  }
  if (requestedActor === "worker") {
    return result("ALLOW", "worker", null, [], { roleDecision: "ALLOW_WORKER" });
  }
  if (requestedActor !== "director" || !bindingProfile) {
    return result("BLOCK", requestedActor || "unknown", block("ROLE_DIRECTOR_UNBOUND", "director requires an active exact binding"), [
      block("ROLE_DIRECTOR_UNBOUND", "director requires an active exact binding"),
    ], {});
  }

  const profile = contract.profiles.director;
  let intent = String(request.intent || "").toLowerCase();
  let dispatchRequired = Boolean(request.dispatchRequired);
  if (request.prompt) {
    const classification = classifyPrompt(request.prompt);
    dispatchRequired ||= classification.dispatchRequired;
    if (classification.dispatchRequired) {
      if (intent && intent !== classification.intent) {
        add("ROLE_INTENT_MISMATCH", `intent=${intent} conflicts with prompt=${classification.intent}`);
      }
      intent = classification.intent;
    } else if (!intent) {
      intent = classification.intent;
    }
  }
  intent ||= "coordinate";
  dispatchRequired ||= DISPATCH_REQUIRED_INTENTS.has(intent);

  const actions = (Array.isArray(request.plannedActions) ? request.plannedActions : []).map((item) => ({
    original: item,
    action: typeof item === "object" ? { ...item } : {},
    actionType: inferRoleAction(item, contract),
  }));
  const dispatchedTaskIds = Array.isArray(request.dispatchedTaskIds) ? request.dispatchedTaskIds : [];
  const workStateDispatch = dispatchedTaskIds.some((taskId) => {
    const task = taskById(workState, taskId);
    return task && task.actorMode === "worker" && Boolean(task.threadId);
  });
  const receipts = runtime.trusted && Array.isArray(runtime.dispatchReceipts) ? runtime.dispatchReceipts : [];
  const runtimeDispatch = receipts.some((receipt) => (
    receipt && dispatchedTaskIds.includes(receipt.taskId) && typeof receipt.threadId === "string"
  ));
  let dispatchSatisfied = Boolean(request.dispatchSatisfied);
  const hasDispatch = workStateDispatch || runtimeDispatch;
  if (dispatchSatisfied && !hasDispatch) {
    add("ROLE_DISPATCH_EVIDENCE_MISSING", "dispatchSatisfied requires matching work-state or runtime receipt");
    dispatchSatisfied = false;
  }
  if (dispatchRequired && actions.length === 0 && !dispatchSatisfied) {
    add("ROLE_DISPATCH_REQUIRED", "dispatch a worker task before open-ended work");
  }

  let sawDispatch = dispatchSatisfied;
  let verificationActions = Number(request.verificationBudgetUsed?.verificationActions || 0);
  let reads = Number(request.verificationBudgetUsed?.readOperations || 0);
  let namedFiles = Number(request.verificationBudgetUsed?.namedFiles || 0);
  let namedCommands = Number(request.verificationBudgetUsed?.namedCommands || 0);
  let threadReads = Number(request.verificationBudgetUsed?.preciseThreadReads || 0);
  for (const value of [verificationActions, reads, namedFiles, namedCommands, threadReads]) {
    if (!Number.isInteger(value) || value < 0) add("ROLE_BUDGET_COUNTER_INVALID", "budget counters must be non-negative integers");
  }

  for (const entry of actions) {
    const { action, actionType } = entry;
    const declared = typeof entry.original === "object" ? entry.original.actionType : null;
    if (declared && declared !== actionType) {
      add("ROLE_ACTION_LABEL_MISMATCH", `declared=${declared} inferred=${actionType}`);
    }
    if (!ROLE_ACTION_TYPES.has(actionType)) {
      add("ROLE_ACTION_UNKNOWN", `unknown action ${actionType}`);
      continue;
    }
    if (actionType === "dispatch") {
      const taskId = action.taskId || parseTaskId(action.prompt);
      const task = taskById(workState, taskId);
      if (!taskId || !task || task.actorMode !== "worker" || task.scope?.length === 0 || task.forbidden?.length === 0 || !isWorkerDispatchPrompt(action.prompt)) {
        add("ROLE_DISPATCH_INCOMPLETE", "dispatch needs a real worker task and a complete prompt");
      } else {
        sawDispatch = true;
      }
      continue;
    }
    if (dispatchRequired && !sawDispatch && !PRE_DISPATCH_ACTIONS.has(actionType)) {
      add("ROLE_DISPATCH_REQUIRED", `director attempted ${actionType} before dispatch`);
      continue;
    }
    if (DIRECTOR_FORBIDDEN_ACTIONS.has(actionType) || profile.forbiddenActions?.includes(actionType)) {
      add("ROLE_ACTION_FORBIDDEN", `${actionType} is forbidden for director`);
      continue;
    }
    if (!profile.allowedActions?.includes(actionType)) {
      add("ROLE_ACTION_NOT_ALLOWED", `${actionType} is not in director allowedActions`);
      continue;
    }
    if (actionType === "record" && (action.paths || []).some((item) => pathLooksLikeBusiness(item, contract.businessPathPatterns))) {
      add("ROLE_BUSINESS_EDIT_FORBIDDEN", "record action cannot target business paths");
      continue;
    }
    if (actionType === "read_worker_summary" && Number(action.summaryLines || 0) > 20) {
      add("ROLE_SUMMARY_TOO_LONG", "worker summary exceeds 20 lines");
      continue;
    }
    if (action.followOnInvestigation === true) {
      add("ROLE_FOLLOW_ON_FORBIDDEN", "follow-on investigation must be re-dispatched");
      continue;
    }
    if (VERIFY_ACTIONS.has(actionType)) {
      verificationActions += 1;
      reads += 1;
      const match = findEvidenceMatch(root, workState, action, actionType, request.workerDeliveryId);
      if (!match) {
        add("ROLE_EVIDENCE_POINTER_REQUIRED", "verification needs a matching ready worker evidence pointer");
        continue;
      }
      if (actionType === "verify_read") {
        namedFiles += 1;
        if ((action.paths || []).length > 1) add("ROLE_MULTI_FILE_READ", "one file per verification");
      }
      if (actionType === "verify_command") {
        namedCommands += 1;
        if (!isSafeVerificationCommand(action.command)) add("ROLE_COMMAND_UNSAFE", "verification command is unsafe");
        if (/[;&|`<>\r\n]|\$\(|%0a/i.test(String(action.command || ""))) {
          add("ROLE_COMMAND_CHAIN_FORBIDDEN", "verification command cannot chain or redirect");
        }
      }
      if (actionType === "precise_thread_read") {
        threadReads += 1;
        const expected = match.pointer.type === "thread" ? match.pointer.value : match.task.threadId;
        if (
          action.threadId !== expected
          || !Number.isInteger(action.maxTurns)
          || action.maxTurns < 1
          || action.maxTurns > 2
          || action.includeOutputs !== false
        ) {
          add("ROLE_THREAD_READ_UNBOUNDED", "thread read must be bounded and exact");
        }
      }
    }
    if (actionType === "orchestrate_release") {
      if (request.authorization?.release !== true || !request.authorization?.reference) {
        add("ROLE_RELEASE_AUTH_REQUIRED", "release orchestration needs current authorization");
      }
    }
  }

  if (
    verificationActions > 1
    || reads > 1
    || namedFiles > (profile.verificationBudget.maxNamedFiles || 1)
    || namedCommands > (profile.verificationBudget.maxNamedCommands || 1)
    || threadReads > (profile.verificationBudget.maxPreciseThreadReads || 1)
  ) {
    add("ROLE_VERIFY_BUDGET_EXCEEDED", "director verification budget exceeded");
  }
  if (request.allowWildcardSearch === true) add("ROLE_WILDCARD_SEARCH_FORBIDDEN", "wildcard search is forbidden");
  if (request.followOnInvestigation === true) add("ROLE_FOLLOW_ON_FORBIDDEN", "follow-on work requires a worker");

  return result(
    blocks.length ? "BLOCK" : "ALLOW",
    "director",
    blocks[0] || null,
    blocks,
    {
      roleDecision: blocks.length ? "BLOCK_DIRECTOR" : "ALLOW_DIRECTOR",
      intent,
      dispatchRequired,
      dispatchSatisfied,
      verificationBudgetUsed: { verificationActions, readOperations: reads, namedFiles, namedCommands, preciseThreadReads: threadReads },
    },
  );
}

export function result(decision, profile, first, blocks, facts) {
  return {
    decision,
    profile,
    code: first?.code || (decision === "ALLOW" ? "ROLE_ALLOW" : "ROLE_BLOCK"),
    message: first?.message || (decision === "ALLOW" ? "request allowed" : "request blocked"),
    required: decision === "BLOCK" ? "HANDOFF" : null,
    blocks,
    facts,
  };
}

export function formatHuman(evaluation) {
  const lines = [
    `ROLE ${evaluation.decision} profile=${evaluation.profile || "unknown"} code=${evaluation.code}`,
    `message=${evaluation.message}`,
  ];
  if (evaluation.required) lines.push(`required=${evaluation.required}`);
  return `${lines.join("\n")}\n`;
}
