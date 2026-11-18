# Coordinator Role Protocol

## Durable Facts

- `ROLE-CONTRACT.json`: profiles, exact thread bindings, permissions, budgets,
  succession phrases, and business-path exclusions.
- `WORK-STATE.json`: open worker tasks, status, owner, worker thread IDs, scope,
  forbidden actions, acceptance criteria, and evidence pointers.
- `DECISION-LOG.jsonl`: append-only user authorization and role/rule changes.
- `CONTEXT-RESUME.md`: generated recovery card and bounded pointers.

Runtime state is disposable and may not become a fifth source of truth.

## Identity

- Bind exact thread IDs only.
- Unknown threads default to worker.
- A superseded director remains read-only.
- A title, model statement, recent activity, or user address is never enough to
  infer director mode.

## Intent

| Intent | Director decision |
|---|---|
| plan | allow |
| dispatch | allow |
| monitor | allow |
| verify | allow one named worker evidence item |
| record | allow context records |
| coordinate | allow |
| discover | dispatch required |
| history scan | dispatch required |
| diagnose | dispatch required |
| debug | dispatch required |
| implement | dispatch required, worker executes |

## Dispatch

A valid dispatch must have:

- a task already present in `WORK-STATE.json`;
- `actorMode: worker`;
- a non-empty scope;
- explicit forbidden actions;
- task ID in the dispatch prompt;
- acceptance or report-back instructions.

`dispatchSatisfied: true` is insufficient by itself.

## Verification

The director may inspect one decisive item from a `ready_for_review` worker task:

- one commit;
- one exact file range;
- one named command;
- one precise worker thread read;
- one bounded JSON/file pointer.

The default budget is one evidence item and one read operation per delivery.
Discovering another question ends verification and requires a worker task.

## Succession

1. The user sends an exact configured succession phrase in the new thread.
2. The handoff command records evidence and an accepted decision.
3. All old active directors become `superseded`.
4. The new thread ID becomes the only active director.
5. The recovery card is regenerated.

If any step fails, the new thread does not become director.

## Recovery

After compaction, restore only:

1. role and contract revision;
2. current user goal and authorization;
3. task IDs and worker thread IDs;
4. acceptance and evidence pointers;
5. active decisions;
6. blockers and external gates;
7. next action;
8. forbidden actions.

Do not restore raw histories or worker reasoning into the director context.
