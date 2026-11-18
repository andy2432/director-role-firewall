#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitExists,
  configuredPath,
  loadConfig,
  readJson,
  readText,
  resolveRepoPath,
} from "./common.mjs";
import { loadWorkState } from "./policy.mjs";

const ROOT = process.cwd();
const MAX_LINES = 20;

function parseArgs(argv) {
  const options = { task: null, pointer: null, start: 1, end: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--task", "--pointer", "--start", "--end", "--root"].includes(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = argv[++index];
    if (!value) throw new Error(`${arg} requires a value`);
    if (arg === "--start" || arg === "--end") options[arg.slice(2)] = Number(value);
    else if (arg === "--root") options.root = path.resolve(value);
    else options[arg.slice(2)] = value;
  }
  if (!options.task || !options.pointer) throw new Error("--task and --pointer are required");
  return options;
}

function printBounded(lines) {
  const bounded = lines.slice(0, MAX_LINES);
  process.stdout.write(`${bounded.join("\n")}\n`);
  if (lines.length > MAX_LINES) console.log(`TRUNCATED remaining_lines=${lines.length - MAX_LINES}`);
}

function jsonPath(value, expression) {
  let current = value;
  for (const segment of expression.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new Error(`json path not found: ${expression}`);
    }
    current = current[segment];
  }
  return current;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root || ROOT;
  const config = loadConfig(root);
  const task = (loadWorkState(root, config).tasks || []).find((item) => item.id === options.task);
  if (!task || task.actorMode !== "worker" || task.status !== "ready_for_review" || !task.threadId) {
    throw new Error("task is not a ready_for_review worker delivery");
  }
  const pointer = (task.evidencePointers || []).find((item) => item.id === options.pointer);
  if (!pointer) throw new Error("evidence pointer not found");

  const lines = [`task=${task.id}`, `workerThread=${task.threadId}`, `pointer=${pointer.id}`, `type=${pointer.type}`];
  if (pointer.type === "commit") {
    if (!commitExists(root, pointer.value)) throw new Error("commit does not exist");
    lines.push(`commit=${pointer.value}`);
    printBounded(lines);
    return;
  }
  if (pointer.type === "thread") {
    lines.push(`thread=${pointer.value}`);
    lines.push("Use a precise thread read with maxTurns<=2 and includeOutputs=false.");
    printBounded(lines);
    return;
  }
  if (["report", "file", "file_range"].includes(pointer.type)) {
    const relative = String(pointer.value).split("#")[0];
    const content = readText(resolveRepoPath(root, relative)).split(/\r?\n/);
    const start = options.start;
    const end = options.end || Math.min(content.length, start + MAX_LINES - 1);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > content.length) {
      throw new Error("invalid line range");
    }
    if (end - start + 1 > MAX_LINES) throw new Error(`range exceeds ${MAX_LINES} lines`);
    lines.push(`path=${relative}`, `range=${start}-${end}`, "---", ...content.slice(start - 1, end));
    printBounded(lines);
    return;
  }
  if (["json", "json_path"].includes(pointer.type)) {
    const [relative, expression = ""] = String(pointer.value).split("#");
    const value = expression ? jsonPath(readJson(resolveRepoPath(root, relative)), expression) : readJson(resolveRepoPath(root, relative));
    lines.push(`path=${relative}`, `jsonPath=${expression || "$"}`, "---", ...JSON.stringify(value, null, 2).split(/\r?\n/));
    printBounded(lines);
    return;
  }
  lines.push(`allowedCheck=${pointer.allowedCheck || "unspecified"}`);
  printBounded(lines);
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
} catch (error) {
  console.error(`EVIDENCE READ BLOCK: ${error.message}`);
  process.exit(1);
}
