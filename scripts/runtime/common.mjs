import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SCHEMA_VERSION = 1;
export const POLICY_VERSION = "1.0.0";
export const ACTIVE_BINDING_STATUS = "active";
export const SUPERSEDED_BINDING_STATUS = "superseded";

export function nowIso() {
  return new Date().toISOString();
}

export function todayCompact() {
  return nowIso().slice(0, 10).replaceAll("-", "");
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

export function writeTextAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function writeJsonAtomic(filePath, value) {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const current = fs.existsSync(filePath) ? readText(filePath) : "";
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(filePath, `${separator}${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return readText(filePath)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return { line: index + 1, value: JSON.parse(line) };
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

export function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function resolveRepoPath(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`path escapes repository: ${relativePath}`);
  }
  return absolute;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

export function loadConfig(root) {
  const configPath = path.join(root, ".director-role-firewall.json");
  if (!fileExists(configPath)) {
    throw new Error(`missing ${configPath}; run scripts/init.mjs first`);
  }
  const config = readJson(configPath);
  const requiredPaths = ["roleContract", "workState", "decisionLog", "contextResume"];
  for (const key of requiredPaths) {
    if (!config.paths?.[key]) throw new Error(`config.paths.${key} is required`);
  }
  return config;
}

export function configuredPath(root, config, key) {
  return resolveRepoPath(root, config.paths[key]);
}

export function runGit(root, args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

export function gitText(root, args) {
  const result = runGit(root, args);
  return result.status === 0 ? result.stdout.trim() : null;
}

export function commitExists(root, ref) {
  if (!ref || !/^[0-9a-f]{7,40}$/i.test(ref)) return false;
  return runGit(root, ["cat-file", "-e", `${ref}^{commit}`]).status === 0;
}

export function findGitDir(root) {
  const dotGit = path.join(root, ".git");
  if (dirExists(dotGit)) return dotGit;
  if (fileExists(dotGit)) {
    const match = readText(dotGit).match(/^gitdir:\s*(.+)$/m);
    if (match) return path.resolve(root, match[1].trim());
  }
  return null;
}

export function withFileLock(lockPath, callback, timeoutMs = 3000) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  while (Date.now() < deadline) {
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  if (fd === null) throw new Error(`timed out acquiring lock: ${lockPath}`);
  try {
    return callback();
  } finally {
    try {
      fs.closeSync(fd);
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Lock cleanup is best effort.
      }
    }
  }
}

export function safeSessionId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
}
