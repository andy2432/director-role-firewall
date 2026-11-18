# Contributing

1. Keep the policy core vendor-neutral and dependency-free.
2. Put runtime-specific behavior under an adapter.
3. Never add a model-controlled bypass.
4. Add a failing test before changing hard-gate semantics.
5. Preserve one active director and read-only superseded threads.
6. Run:

```bash
npm test
```

7. Keep public examples synthetic. Do not include real thread IDs, production
   paths, customer data, credentials, or private logs.
