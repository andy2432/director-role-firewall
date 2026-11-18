---
name: director-role-firewall
description: Enforce director or coordinator agents as context firewalls, with exact thread bindings, dispatch-first discovery, bounded evidence verification, runtime hooks, and atomic role handoff. Use when multi-agent roles drift, coordinators start doing worker investigation, context compression erases role boundaries, or a new director thread must inherit the role safely.
---

# Director Role Firewall

Keep the coordinator role outside chat memory. The repository must hold the role
contract, work state, decisions, and evidence pointers. Runtime adapters enforce
that state before tool execution.

## Core Invariants

1. Bind a director only by exact thread ID. Titles and self-description are not
   evidence.
2. Allow at most one active director. A superseded director stays read-only and
   must not fall back to worker mode.
3. Discovery, diagnosis, history reconstruction, debugging, and implementation
   require a real worker task before execution.
4. Accept dispatch completion only from matching work state or a runtime receipt
   produced after a real create/send tool call.
5. Allow the director one worker summary and one named evidence item per
   delivery. Any follow-on question becomes a rejection or a new worker task.
6. Store only disposable current-turn state under the Git directory. Never store
   project facts there.
7. Role rule changes append a decision and increment the contract revision.
8. Succession requires an exact user command. Handoff atomically supersedes the
   old director, binds the new thread, records evidence, and regenerates the
   recovery card.

## Start Workflow

1. Inspect the target repository and confirm whether the user authorized role
   initialization or migration.
2. Read [references/role-protocol.md](references/role-protocol.md).
3. Run the initializer:

```bash
node scripts/init.mjs --root <repo> --director-thread-id <thread-id>
```

4. For Codex lifecycle enforcement, generate the adapter:

```bash
node scripts/init.mjs --root <repo> --director-thread-id <thread-id> --adapter codex
```

5. For another agent runtime, expose `role-gate.mjs` as a mandatory pre-action
   command. Read [references/runtime-adapters.md](references/runtime-adapters.md).
6. Run the generated self-check:

```bash
node <repo>/.director-role-firewall/role-gate.mjs --root <repo> --self-test
```

## Evaluate An Action

The vendor-neutral protocol is JSON in, JSON out:

```bash
node <repo>/.director-role-firewall/role-gate.mjs \
  --root <repo> \
  --request request.json \
  --json
```

Exit codes:

- `0`: allow.
- `1`: block.
- `2`: configuration error.

Never let an integrating runtime treat configuration errors as allow.

## Handoff

Use only after the user explicitly asks to replace the director:

```bash
node <repo>/.director-role-firewall/handoff.mjs \
  --root <repo> \
  --thread-id <new-thread-id> \
  --prompt "接任项目总监"
```

For non-Chinese use, configure equivalent exact phrases in
`successionPhrases` inside the role contract.

## Verification

Run:

```bash
npm test
python <skill-creator>/scripts/quick_validate.py <skill-directory>
```

Also verify at least once through the target runtime adapter. A pure CLI pass
does not prove hooks are trusted or invoked.

## Boundaries

- This is a guardrail, not an OS sandbox.
- Hosted tools outside the adapter's interception path can bypass a hook.
- External actions still require their own deployment or release authorization.
- Do not add a second role database. The role contract and work state remain the
  only durable facts; runtime state is disposable.
- Do not weaken hard gates by adding a model-controlled bypass. Change the
  contract through a recorded user decision instead.

Read [references/failure-modes.md](references/failure-modes.md) before changing
verification budgets or introducing exceptions.
