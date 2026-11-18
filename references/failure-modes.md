# Failure Modes And Non-Negotiable Boundaries

## Boundary

- The core cannot prove an external state without a fresh receipt.
- The generic CLI cannot force a runtime to call it.
- Codex hooks do not cover every possible tool path and are not a sandbox.
- A public repository can contain a policy implementation, not authority to
  deploy, pay, release, or modify production data.

## Common Failures

1. **Narrow rule:** "do not edit code" still allows history scans, rollout
   parsing, debugging, and long-log analysis. Cover action classes explicitly.
2. **Title inference:** a thread called "director" is not a director. Require an
   exact active binding.
3. **Boolean dispatch forgery:** a model can set `dispatchSatisfied=true`. Require
   a matching worker task or a runtime receipt from a real dispatch tool.
4. **Duplicate policy:** `AGENTS.md`, hooks, and CLI grow separate allowlists.
   Use one policy core and generate projections.
5. **Dual state:** runtime state becomes a second project ledger. Keep it
   disposable and reconstruct facts from durable files.
6. **Verification expansion:** one anomaly triggers a full re-investigation in
   the director. Block follow-on work and dispatch a new task.
7. **Superseded fallback:** removing director status turns an old coordinator
   into an unrestricted worker. Keep superseded threads read-only.
8. **Hook trust gap:** the project is trusted but the hooks are not. Verify
   actual hook execution and trust.
9. **Uncovered tool:** a new MCP, hosted search, or shell path bypasses the
   adapter. Add coverage and test canonical tool names.
10. **Summary inflation:** worker output enters the coordinator unbounded.
    Enforce a compact summary and evidence pointers.

## Safe Changes

Do not add a model-controlled bypass. Change the role contract through an
accepted user decision, increment its revision, update tests, and rerun the
actual runtime adapter.
