```text
actorMode: worker
taskId: <TASK-ID>
scope:
- <allowed path, module, or data source>
forbidden:
- <business implementation, deployment, production data, or other boundary>
acceptance:
- <verifiable result>
evidence:
- <commit, file range, command output, thread, or hash>
reportBack:
- summary_lines: <=20
- evidence_pointers_only: true
- unresolved_items_separate: true
```
