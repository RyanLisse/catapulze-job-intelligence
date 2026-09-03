# Gate: flaky and slow tests

The pre-push gate (`tools/quality/gate.sh`, run by lefthook) executes the whole
`bun test` suite in one process after `ultracite`, `qlty` and `check-types`.
A test that is fine on an idle laptop can exceed Bun's **5000 ms default
per-test budget** while the gate (or a parallel worktree) saturates the CPU.
This runbook is where such tests are tracked and where the rules for fixing
them live. `git push --no-verify` is never the fix.

## Rules

1. **Size the budget to what the test forks, not to the work.** A test that
   spawns a Bun runtime, a Docker container, or a network round-trip must pass
   an explicit `{ timeout }` with a comment stating the measured cost it is
   sized for. The 5 s default is for in-process tests only.
2. **Prefer in-process over spawn.** If the thing under test can be called as a
   function, test it that way and keep at most one spawned "smoke" run to prove
   the argv/exit-code path. Each `bun <file>.ts` spawn re-transpiles the
   workspace it imports (1.5 s warm, 3.4 s cold measured for
   `benchmarks/relevance/export-judgments.ts` on an M-series laptop).
3. **Reproduce under load before declaring a test fixed.** Run the suite in a
   loop while the gate's heaviest phase runs beside it:

   ```bash
   ( while true; do bun run check-types >/dev/null 2>&1; done ) & LOAD=$!
   for i in 1 2 3 4 5; do bun test <path-or-filter>; echo "exit=$?"; done
   kill "$LOAD"
   ```

   Record the wall time of the slowest run in the ledger below. Run the test
   command unpiped (or with `set -o pipefail`) so the exit code you read is the
   test's, not `tail`'s.
4. **Non-DB specs can skip the Postgres preload.** `bunfig.toml` preloads
   `tools/postgres/test-isolation.ts`, which creates a throwaway database before
   the first test and throws on an auth failure. To iterate on a subset that
   never touches Postgres, set `DATABASE_TEST_URL` to any non-empty value
   (`DATABASE_TEST_URL=postgresql://preload-skipped bun test benchmarks/relevance`);
   the preload then no-ops. Never do this for the full gate.
5. **One row per incident, kept after the fix.** The ledger is the history of
   what the gate has tolerated and why; delete rows only when the test itself is
   deleted.

## Ledger

| Date | Test | Symptom | Root cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 2026-09-03 | `benchmarks/relevance/export-judgments.spec.ts` › "writes a deterministic CSV + md pair and reruns byte-identical" | Timed out twice in the pre-push gate (5000 ms and 10092 ms observed) while `check-types` ran; green when run alone. | The test spawned `bun benchmarks/relevance/export-judgments.ts` twice; each spawn boots a fresh runtime that transpiles `@ji/application`, `@ji/connectors`, `@ji/search`, `@ji/domain` and replays every connector over its fixtures (1.5–3.4 s each idle). Two spawns under a 5 s default budget left no headroom under load. The Postgres preload was not involved: it runs once per process, before any test. | `export-judgments.ts` now exports `exportJudgments()`; the determinism test calls it twice in-process in a `mkdtemp` dir. One spawned smoke test remains with an explicit 60 s budget. Verified 10× `bun test benchmarks/relevance` (two 5× loops) while `turbo run check-types --force` looped, load avg 6.6–12.9: 26/26 green every run. Spawned smoke test max 14.1 s (would have failed the old 5 s default on its own), in-process determinism test max 0.55 s. | fixed |
