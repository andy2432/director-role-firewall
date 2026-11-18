import fs from "node:fs";
import path from "node:path";
import {
  findGitDir,
  readJson,
  safeSessionId,
  sha256,
  withFileLock,
  writeJsonAtomic,
} from "./common.mjs";

function stateDirectory(root, config) {
  const configured = config.runtimeStateDir || ".git/director-role-firewall";
  if (configured.replaceAll("\\", "/").startsWith(".git/")) {
    const gitDir = findGitDir(root);
    if (!gitDir) throw new Error("runtime state requires a Git repository or an explicit runtimeStateDir");
    return path.join(gitDir, ...configured.replaceAll("\\", "/").split("/").slice(1));
  }
  const directory = path.resolve(root, configured);
  if (directory !== path.resolve(root) && !directory.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error("runtimeStateDir escapes repository");
  }
  return directory;
}

export function statePath(root, config, sessionId) {
  return path.join(stateDirectory(root, config), `${safeSessionId(sessionId)}.json`);
}

export function defaultState(sessionId, contract) {
  return {
    schemaVersion: 1,
    sessionId,
    contractRevision: contract?.revision || null,
    contractHash: contract ? sha256(JSON.stringify(contract)) : null,
    currentTurn: {
      turnId: null,
      intent: "coordinate",
      dispatchRequired: false,
      dispatchSatisfied: false,
      dispatchedTaskIds: [],
      dispatchReceipts: [],
      activeTaskId: null,
      budgetUsed: {
        verificationActions: 0,
        readOperations: 0,
        namedFiles: 0,
        namedCommands: 0,
        preciseThreadReads: 0,
      },
    },
    compaction: {
      count: 0,
      pending: false,
      roleCardPending: false,
    },
    violations: [],
    updatedAt: null,
  };
}

export function readState(root, config, sessionId) {
  const filePath = statePath(root, config, sessionId);
  return fs.existsSync(filePath) ? readJson(filePath) : null;
}

export function ensureState(root, config, sessionId, contract) {
  const filePath = statePath(root, config, sessionId);
  return withFileLock(`${filePath}.lock`, () => {
    const state = fs.existsSync(filePath) ? readJson(filePath) : defaultState(sessionId, contract);
    state.contractRevision = contract?.revision || null;
    state.contractHash = contract ? sha256(JSON.stringify(contract)) : null;
    state.updatedAt = new Date().toISOString();
    writeJsonAtomic(filePath, state);
    return state;
  });
}

export function updateState(root, config, sessionId, updater) {
  const filePath = statePath(root, config, sessionId);
  return withFileLock(`${filePath}.lock`, () => {
    if (!fs.existsSync(filePath)) throw new Error(`state missing for session ${sessionId}`);
    const state = readJson(filePath);
    updater(state);
    state.updatedAt = new Date().toISOString();
    writeJsonAtomic(filePath, state);
    return state;
  });
}

export function resetTurn(state, turnId, classification) {
  state.currentTurn = {
    turnId,
    intent: classification.intent,
    dispatchRequired: Boolean(classification.dispatchRequired),
    dispatchSatisfied: false,
    dispatchedTaskIds: [],
    dispatchReceipts: [],
    activeTaskId: null,
    budgetUsed: {
      verificationActions: 0,
      readOperations: 0,
      namedFiles: 0,
      namedCommands: 0,
      preciseThreadReads: 0,
    },
  };
}

export function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

export function extractThreadId(value) {
  const pattern = /\b[0-9a-zA-Z][0-9a-zA-Z._:-]{7,}\b/;
  for (const text of collectStrings(value)) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}
