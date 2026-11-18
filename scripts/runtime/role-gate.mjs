#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson } from "./common.mjs";
import {
  classifyPrompt,
  evaluateRequest,
  formatHuman,
  loadRoleContract,
  loadWorkState,
  validateContractRuntime,
} from "./policy.mjs";

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    requestPath: null,
    json: false,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = path.resolve(argv[++index]);
    else if (arg === "--request") options.requestPath = argv[++index];
    else if (arg === "--json") options.json = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: role-gate.mjs --root <repo> --request <request.json|-> [--json]\n       role-gate.mjs --root <repo> --self-test");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function readRequest(options) {
  const raw = options.requestPath && options.requestPath !== "-"
    ? fs.readFileSync(path.resolve(options.requestPath), "utf8")
    : fs.readFileSync(0, "utf8");
  if (!raw.trim()) throw new Error("request JSON is required via --request or stdin");
  return JSON.parse(raw);
}

function selfTest(root) {
  const config = loadConfig(root);
  const contract = loadRoleContract(root, config);
  const workState = loadWorkState(root, config);
  const errors = validateContractRuntime(contract, { root, config });
  const classification = classifyPrompt("Investigate the history and find the root cause");
  const checks = [
    { name: "contract-runtime", pass: errors.length === 0, details: errors },
    { name: "discovery-intent", pass: classification.intent === "discover" && classification.dispatchRequired },
    { name: "work-state", pass: Array.isArray(workState.tasks) },
  ];
  const failed = checks.filter((check) => !check.pass);
  return { decision: failed.length ? "BLOCK" : "ALLOW", checks, failed };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.selfTest) {
      const result = selfTest(options.root);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.decision === "ALLOW" ? 0 : 1);
    }
    const request = readRequest(options);
    const config = loadConfig(options.root);
    const result = evaluateRequest({ root: options.root, config, request });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else process.stdout.write(formatHuman(result));
    process.exit(result.decision === "ALLOW" ? 0 : 1);
  } catch (error) {
    console.error(`ROLE CONFIG ERROR: ${error.message}`);
    process.exit(2);
  }
}

main();
