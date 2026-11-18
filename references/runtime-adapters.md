# Runtime Adapter Guide

## Generic Contract

The policy core accepts a JSON request:

```json
{
  "threadId": "thread-12345678",
  "actorMode": "director",
  "intent": "verify",
  "prompt": "verify this evidence",
  "plannedActions": [
    {
      "toolName": "exec_command",
      "command": "git show --stat abcdef0"
    }
  ],
  "dispatchSatisfied": true,
  "dispatchedTaskIds": ["TASK-001"],
  "workerDeliveryId": "TASK-001",
  "verificationBudgetUsed": {
    "verificationActions": 0,
    "readOperations": 0,
    "namedFiles": 0,
    "namedCommands": 0,
    "preciseThreadReads": 0
  }
}
```

The CLI returns stable result codes and exit status:

- `0`: allow.
- `1`: block.
- `2`: config or integration error.

Do not fail open on `2`.

## Generic Wrapper

Agent runtimes that expose a pre-tool callback should:

1. map the actual tool and arguments to an `action`;
2. include thread/session ID, prompt-derived intent, dispatch state, and budget;
3. call the policy core;
4. refuse the tool when blocked or when configuration fails;
5. write only disposable state.

If a runtime has no pre-tool callback, enforce through a command wrapper. Anything
that bypasses the wrapper is outside the firewall.

## Codex Adapter

The Codex adapter uses lifecycle hooks:

- `SessionStart`: inject the role card on startup, resume, clear, compact, or fork.
- `UserPromptSubmit`: classify the prompt and inject a dispatch warning.
- `PreToolUse`: deny unsupported coordinator actions before they run.
- `PostToolUse`: record real dispatch receipts.
- `PreCompact` / `PostCompact`: mark recovery state.
- `Stop`: prevent normal completion after a recorded role violation.

Install with:

```bash
node scripts/init.mjs --root <repo> --director-thread-id <id> --adapter codex
```

The user must review and trust project hooks. Current and future Codex releases
may alter hook coverage. Test the actual supported tool names in the target
client.

## Other Runtime Examples

- LangGraph or custom orchestrators: call the gate before node/tool dispatch.
- Claude Code-style wrappers: enforce in a `PreToolUse` equivalent if available;
  otherwise wrap shell actions.
- CI agents: validate task and evidence JSON before allowing mutating jobs.
- Manual agents: require the coordinator to submit the request to the CLI and
  preserve the block output.
