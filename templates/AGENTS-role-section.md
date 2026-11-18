## Director Role Firewall

- Resolve director identity only from an exact active binding in
  `agent-context/ROLE-CONTRACT.json`.
- Discovery, diagnosis, history scans, raw logs, debugging, and implementation
  must be dispatched to a worker before execution.
- Director verification is limited to one worker summary and one named evidence
  item per delivery.
- Runtime state is disposable. Project facts belong only in the role contract,
  work state, decision log, and generated recovery card.
- New directors require the exact configured succession phrase. The old director
  becomes read-only and cannot fall back to worker mode.
