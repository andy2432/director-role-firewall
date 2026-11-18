# Director Role Firewall

An open, vendor-neutral Skill and runtime kit for preventing coordinator or
director agents from drifting into worker tasks.

The repository provides:

- a structured role contract;
- deterministic dispatch-first evaluation;
- one-evidence acceptance budgets;
- exact coordinator handoff;
- disposable runtime state;
- a Codex lifecycle-hooks adapter;
- a generic JSON/CLI adapter usable by other agent frameworks.

## Why

Long-running coordinators often start with a valid instruction such as "delegate
investigation", then later perform history scans, raw log analysis, debugging, or
implementation themselves. Prompt-only rules are lost or weakened during
compression. The same title may also be reused by a normal worker.

This kit treats the coordinator as a **context firewall**. The coordinator keeps
goals, decisions, task IDs, thread IDs, status, blockers, evidence pointers, and
the next action. Context-heavy work belongs to workers.

## Architecture

```text
ROLE-CONTRACT.json
WORK-STATE.json
DECISION-LOG.jsonl
        |
        v
  role-policy core
        |
        +-- generic JSON/CLI gate
        +-- Codex lifecycle hooks
        +-- other runtime adapters
```

Durable facts live in `agent-context/`. Runtime turn state lives under the Git
directory and is safe to delete.

## Install

Clone or copy this skill, then initialize a target repository:

```bash
node scripts/init.mjs --root /path/to/repo --director-thread-id <thread-id>
```

The initializer writes:

```text
.director-role-firewall.json
agent-context/
  ROLE-CONTRACT.json
  WORK-STATE.json
  DECISION-LOG.jsonl
  CONTEXT-RESUME.md
.director-role-firewall/
  role-gate.mjs
  handoff.mjs
  evidence-read.mjs
  policy.mjs
  common.mjs
```

Use `--adapter codex` to also install a project `.codex/hooks.json` and
`.director-role-firewall/codex-role-guard.mjs`.

Codex hooks require an explicit first-use trust decision. A trusted project and
trusted hooks are separate checks.

## Generic Agent Integration

Before every side-effecting or context-heavy action, run:

```bash
node .director-role-firewall/role-gate.mjs \
  --root . \
  --request action.json \
  --json
```

Exit code `0` means allow, `1` means block, and `2` means the integration is
misconfigured. Runtimes must not fail open on exit code `2`.

See `references/runtime-adapters.md` for request fields and adapter patterns.

## Director Succession

The current contract ships with exact phrases:

- `接任项目总监`
- `Act as project director`

When a new thread sends one of those phrases, the handoff command:

1. marks the old director `superseded`;
2. binds the new thread ID as the only active director;
3. records an accepted user decision and handoff evidence;
4. regenerates the compact recovery card.

The old thread remains read-only rather than becoming an unrestricted worker.

## Tests

```bash
npm test
```

The suite covers dispatch-first blocking, fabricated dispatch evidence, superseded
coordinators, exact evidence reads, one-item budgets, automatic handoff, and
single-active-director invariants.

## Boundaries

- The gate validates the request it receives. A runtime that does not call the
  gate can bypass it.
- Hooks intercept supported tool paths only. Proprietary, hosted, or newly added
  tools require adapter coverage.
- This does not replace deployment, payment, privacy, or release authorization.
- The policy can only validate evidence references it can inspect. External state
  still requires a fresh receipt.

## License

MIT. See `LICENSE`.
